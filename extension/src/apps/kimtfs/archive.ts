// One door onto every archive KimtFS can unpack — and an honest refusal for the ones it cannot.
//
// The formats here are exactly what the browser can decompress with no bundled dependency:
//   zip   — CompressionStream/DecompressionStream('deflate-raw') (see zip.ts)
//   gzip  — DecompressionStream('gzip'), a single-member stream
//   tar   — an uncompressed concatenation, read by hand (see tar.ts)
//   tgz   — gunzip, then read the tar
// Everything runs on bytes already in this browser. Nothing is uploaded to unpack it.
//
// `.7z .rar .xz .zst .bz2` have NO native browser decompressor, so each would mean bundling a
// WASM library — a payload, a licence, and a hosting decision. That is a separate call, not a
// rider here: we recognise them only enough to say so plainly (see UnsupportedArchiveError).

import { listZip, readZipEntry, type ZipListing } from './zip.js';
import { listTar, readTarEntry } from './tar.js';

export type ArchiveFormat = 'zip' | 'gzip' | 'tar' | 'tgz';

/** Extensions we recognise as archives but cannot open without a bundled decompressor. */
const UNSUPPORTED_ARCHIVE_EXTS = ['7z', 'rar', 'xz', 'zst', 'bz2'] as const;

/** Thrown when the archive is a real format we deliberately do not bundle a decompressor for. */
export class UnsupportedArchiveError extends Error {
  constructor(readonly ext: string) {
    super(`Kimtos can’t open .${ext} archives yet.`);
    this.name = 'UnsupportedArchiveError';
  }
}

/** One normalised entry, uniform across every format. */
export interface ArchiveItem {
  path: string; // `/`-separated; a trailing `/` marks a directory
  size: number; // uncompressed bytes (0 for a directory)
  isDir: boolean;
}

/** An archive opened for reading: its entries, plus lazy access to each one's bytes. */
export interface OpenedArchive {
  format: ArchiveFormat;
  items: ArchiveItem[];
  read(item: ArchiveItem): Promise<Uint8Array>;
}

/**
 * The format of an archive, by name — or `null` if the name is not an archive we open. Compound
 * suffixes are checked before their tails so `foo.tar.gz` is a tar, not a lone gzip.
 */
export function archiveFormat(name: string): ArchiveFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tgz';
  if (lower.endsWith('.tar')) return 'tar';
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.gz')) return 'gzip';
  return null;
}

/** The extension of a recognised-but-unsupported archive, or `null`. */
export function unsupportedArchiveExt(name: string): string | null {
  const lower = name.toLowerCase();
  return UNSUPPORTED_ARCHIVE_EXTS.find((ext) => lower.endsWith(`.${ext}`)) ?? null;
}

/** True when this name is an archive KimtFS can actually extract (the menu/viewer gate). */
export const canExtract = (name: string): boolean => archiveFormat(name) !== null;

/**
 * True when the file is ALREADY a compressed archive — so offering to "Compress to ZIP" it
 * is pointless: deflate cannot shrink already-compressed bytes (buildZip stores them
 * verbatim rather than grow them), so re-zipping just wraps the file in a bigger container.
 * Covers the compressed formats we extract (zip / gzip / tgz) AND the ones we only
 * recognise (7z, rar, xz, zst, bz2 — all compressed). A bare `.tar` is deliberately NOT
 * included: it is an uncompressed concatenation, so zipping a tar genuinely shrinks it.
 */
export function isCompressedArchive(name: string): boolean {
  const format = archiveFormat(name);
  if (format === 'zip' || format === 'gzip' || format === 'tgz') return true;
  return unsupportedArchiveExt(name) !== null;
}

/**
 * The base name to unpack into — the filename minus its archive suffix. `photos.zip` → `photos`,
 * `site.tar.gz` → `site`, `notes.txt.gz` → `notes.txt` (a lone gzip decompresses to that file).
 */
export function archiveBaseName(name: string): string {
  const lower = name.toLowerCase();
  const suffix = lower.endsWith('.tar.gz')
    ? 7
    : lower.endsWith('.tgz')
      ? 4
      : lower.endsWith('.tar')
        ? 4
        : lower.endsWith('.zip')
          ? 4
          : lower.endsWith('.gz')
            ? 3
            : 0;
  return (suffix ? name.slice(0, -suffix) : name) || name;
}

/**
 * Reject any entry path that would escape the destination — the one place a malicious or
 * malformed archive can write outside where the user asked (zip-slip / tar-slip). An absolute
 * path, a Windows drive path, or any `..` segment is refused. Callers skip the entry rather than
 * write it, on BOTH the Here and to-folder paths.
 */
export function isSafeEntryPath(raw: string): boolean {
  if (!raw) return false;
  if (raw.startsWith('/') || raw.startsWith('\\')) return false;
  if (/^[a-zA-Z]:[\\/]/.test(raw)) return false; // C:\… , C:/…
  return !raw.replace(/\\/g, '/').split('/').includes('..');
}

/**
 * A name that does not collide with anything already in the folder — appending ` (2)`, ` (3)`, …
 * before the extension, the file-manager norm. Used by Extract Here so an unpacked entry never
 * overwrites an existing sibling. `taken` is the set of names already present.
 */
export function uniqueChildName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name; // `.env` keeps its whole name as the stem
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * One resolved step of an extraction: create a folder, or write a file. `path` is `/`-separated
 * and RELATIVE to the destination root, already collision-resolved — so the executor only has to
 * create folders and upload files, with no re-deciding of names. Every folder op precedes its
 * contents, so the executor can build ids top-down.
 */
export type ExtractOp = { kind: 'dir'; path: string } | { kind: 'file'; path: string; item: ArchiveItem };

/**
 * Turn an archive's flat entry list into an ordered plan of folders-to-make and files-to-write,
 * applying — in ONE place, so the app and the tests agree — the two rules extraction must never
 * get wrong:
 *   - the zip-slip guard: any entry that escapes the destination is dropped, never written;
 *   - the collision policy: a name already present (in `existing`, the destination's current
 *     children, for Extract Here) is auto-renamed `name (2)` rather than overwriting it.
 * The paths it returns are final: the executor creates/uploads them verbatim under the root.
 */
export function planExtraction(items: ArchiveItem[], existing: readonly string[] = []): ExtractOp[] {
  const ops: ExtractOp[] = [];
  const taken = new Map<string, Set<string>>([['', new Set(existing)]]); // resolved dir -> child names
  const resolvedDir = new Map<string, string>([['', '']]); // archive dir path -> resolved dir path

  const splitLast = (p: string): [string, string] => {
    const trimmed = p.replace(/\/$/, '');
    const cut = trimmed.lastIndexOf('/');
    return cut < 0 ? ['', trimmed] : [p.slice(0, cut + 1), trimmed.slice(cut + 1)];
  };

  const ensureDir = (archiveDir: string): string => {
    const known = resolvedDir.get(archiveDir);
    if (known !== undefined) return known;
    const [parentDir, rawName] = splitLast(archiveDir);
    const parent = ensureDir(parentDir);
    const siblings = taken.get(parent)!;
    const name = uniqueChildName(rawName, siblings);
    siblings.add(name);
    const resolved = parent ? `${parent}/${name}` : name;
    taken.set(resolved, new Set());
    resolvedDir.set(archiveDir, resolved);
    ops.push({ kind: 'dir', path: resolved });
    return resolved;
  };

  for (const item of items) {
    if (!isSafeEntryPath(item.path)) continue; // zip-slip: refuse anything that escapes the root
    const [dir, rawName] = splitLast(item.path);
    if (!rawName) continue;
    if (item.isDir) {
      ensureDir(item.path);
      continue;
    }
    const parent = ensureDir(dir);
    const siblings = taken.get(parent)!;
    const name = uniqueChildName(rawName, siblings);
    siblings.add(name);
    ops.push({ kind: 'file', path: parent ? `${parent}/${name}` : name, item });
  }
  return ops;
}

/** Decompress a single-member gzip stream natively. */
export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream as ReadableStream).arrayBuffer());
}

/**
 * Open an archive for reading. Throws `UnsupportedArchiveError` for a recognised-but-unbundled
 * format, and a plain error if the bytes are not the archive the name claims. Listing is cheap:
 * zip and tar read only their directory/headers, so nothing inflates until `read` is called.
 */
export async function openArchive(name: string, bytes: Uint8Array): Promise<OpenedArchive> {
  const unsupported = unsupportedArchiveExt(name);
  if (unsupported) throw new UnsupportedArchiveError(unsupported);

  const format = archiveFormat(name);
  if (!format) throw new Error('Not a recognised archive');

  if (format === 'zip') {
    const listing = listZip(bytes);
    const byPath = new Map<string, ZipListing>(listing.map((e) => [e.path, e]));
    return {
      format,
      items: listing.map((e) => ({ path: e.path, size: e.size, isDir: e.path.endsWith('/') })),
      read: (item) => readZipEntry(bytes, byPath.get(item.path)!),
    };
  }

  if (format === 'gzip') {
    const data = await gunzip(bytes);
    return {
      format,
      items: [{ path: archiveBaseName(name) || 'file', size: data.length, isDir: false }],
      read: async () => data,
    };
  }

  // tar or tgz — gunzip first for the compressed variant, then walk the tar headers.
  const tarBytes = format === 'tgz' ? await gunzip(bytes) : bytes;
  const entries = listTar(tarBytes);
  const byPath = new Map(entries.map((e) => [e.path, e]));
  return {
    format,
    items: entries.map((e) => ({ path: e.path, size: e.size, isDir: e.isDir })),
    read: async (item) => readTarEntry(tarBytes, byPath.get(item.path)!),
  };
}

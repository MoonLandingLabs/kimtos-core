// TAR, read by hand — no dependency.
//
// A tar is the simplest archive there is: a flat concatenation of 512-byte header blocks, each
// followed by the file's bytes padded up to the next 512-byte boundary. There is no compression
// and no central directory — you walk it front to back. `tar.gz`/`.tgz` is just this stream run
// through gzip, which the browser's `DecompressionStream('gzip')` undoes first (see archive.ts).
//
// Everything here runs on bytes already in this browser. Nothing is uploaded.

export interface TarEntry {
  /** Full path inside the archive, `/`-separated. A trailing `/` marks a directory. */
  path: string;
  size: number; // uncompressed byte length (0 for a directory)
  offset: number; // where this entry's data starts in the tar bytes
  isDir: boolean;
}

const BLOCK = 512;
const dec = new TextDecoder();

// A NUL-terminated ASCII field. Tar pads names and numbers with NULs (and sometimes spaces).
function readStr(b: Uint8Array, at: number, len: number): string {
  let end = at;
  const stop = Math.min(at + len, b.length);
  while (end < stop && b[end] !== 0) end++;
  return dec.decode(b.subarray(at, end));
}

// Sizes and mtimes are stored as octal ASCII, space/NUL padded.
function readOctal(b: Uint8Array, at: number, len: number): number {
  const s = readStr(b, at, len).trim();
  return s ? parseInt(s, 8) || 0 : 0;
}

// The header checksum: the sum of all 512 header bytes, with the 8-byte checksum field itself
// counted as spaces. It is how we tell a real tar block from random bytes that merely share the
// extension — a `.tar` that is not one must fail loudly, not spray garbage into the file system.
function headerChecksumOk(b: Uint8Array, at: number): boolean {
  const stored = readOctal(b, at + 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += i >= 148 && i < 156 ? 0x20 : (b[at + i] ?? 0);
  }
  return sum === stored;
}

const roundUp = (n: number): number => Math.ceil(n / BLOCK) * BLOCK;

/**
 * List a tar's entries without copying any file data — each entry just records where its bytes
 * live, so `readTarEntry` can hand back a view. Throws if this is not a tar; the caller decides
 * what to tell the user.
 */
export function listTar(bytes: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let at = 0;
  // GNU tar stores an over-long name in an 'L' entry whose data block IS the name; it applies to
  // the entry that follows.
  let longName: string | null = null;

  while (at + BLOCK <= bytes.length) {
    // Two consecutive zero blocks end the archive; the first zero block (empty name) is enough.
    if (bytes[at] === 0) break;
    if (!headerChecksumOk(bytes, at)) throw new Error('Not a TAR archive');

    const size = readOctal(bytes, at + 124, 12);
    const type = String.fromCharCode(bytes[at + 156] ?? 0x30);
    const dataAt = at + BLOCK;

    if (type === 'L') {
      // GNU long-name extension: the payload is the real path for the next entry.
      longName = readStr(bytes, dataAt, size).replace(/\0+$/, '');
      at = dataAt + roundUp(size);
      continue;
    }
    if (type === 'x' || type === 'g') {
      // A pax extended header — metadata we do not use. Skip it and its payload.
      at = dataAt + roundUp(size);
      longName = null;
      continue;
    }

    const name = readStr(bytes, at, 100);
    const prefix = readStr(bytes, at + 345, 155); // USTAR splits a long path across two fields
    let full = longName ?? (prefix ? `${prefix}/${name}` : name);
    longName = null;

    const isDir = type === '5' || full.endsWith('/');
    if (isDir && !full.endsWith('/')) full += '/';
    out.push({ path: full, size: isDir ? 0 : size, offset: dataAt, isDir });
    at = dataAt + roundUp(size);
  }
  return out;
}

/** The bytes of one entry — a view over the tar, no copy. */
export function readTarEntry(bytes: Uint8Array, entry: TarEntry): Uint8Array {
  return bytes.subarray(entry.offset, entry.offset + entry.size);
}

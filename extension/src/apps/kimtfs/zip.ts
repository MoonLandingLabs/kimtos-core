// ZIP, written by hand — no dependency.
//
// The browser already ships the hard part: `CompressionStream('deflate-raw')` is the exact
// stream a ZIP entry holds. What is left is the container — local headers, a central
// directory, an end-of-central-directory record, and a CRC-32 — which is a few hundred lines
// of byte layout. Pulling in a library for that would cost a package, a bundle, and a licence
// to audit, to save code that has not changed since 1989.
//
// Everything here runs on bytes already in this browser. Nothing is uploaded to compress it.

export interface ZipEntry {
  /** Path inside the archive, `/`-separated. A trailing `/` marks an empty directory. */
  path: string;
  data: Uint8Array;
}

const STORE = 0;
const DEFLATE = 8;
const UTF8_FLAG = 0x0800; // names are UTF-8, not the ancient IBM code page

// CRC-32 (the one ZIP uses). Table built once — the naive bit-by-bit loop is ~10x slower on
// the multi-megabyte files this app exists to hold.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// CompressionStream is typed as a TransformStream over BufferSource, so it does not narrow to
// TransformStream<Uint8Array, Uint8Array>. Read the output back through Response, which is what
// both this and DecompressionStream actually produce.
async function through(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const src = new Blob([bytes as BlobPart]).stream().pipeThrough(stream as ReadableWritablePair);
  return new Uint8Array(await new Response(src as ReadableStream).arrayBuffer());
}

const deflate = (b: Uint8Array): Promise<Uint8Array> => through(b, new CompressionStream('deflate-raw'));
const inflate = (b: Uint8Array): Promise<Uint8Array> => through(b, new DecompressionStream('deflate-raw'));

// ── writing ──────────────────────────────────────────────────────────────────

// MS-DOS date/time, which is what a ZIP stores. Two-second resolution and a 1980 epoch: not
// our choice, but every tool that opens the archive expects it.
function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 0x1f),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class Bytes {
  private parts: Uint8Array[] = [];
  length = 0;
  push(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  u16(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff]));
  }
  u32(n: number): void {
    this.push(new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]));
  }
  merge(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/**
 * Build a ZIP archive. `when` is injectable so a test can assert on exact bytes — a ZIP
 * embeds the clock, so an archive built from the same input twice is otherwise never equal.
 */
export async function buildZip(entries: ZipEntry[], when: Date = new Date()): Promise<Uint8Array> {
  const { time, date } = dosTime(when);
  const enc = new TextEncoder();
  const body = new Bytes();
  const central = new Bytes();

  for (const entry of entries) {
    const isDir = entry.path.endsWith('/');
    const name = enc.encode(entry.path);
    const raw = isDir ? new Uint8Array(0) : entry.data;
    const sum = crc32(raw);

    // Compress — but keep the smaller of the two. Deflate makes already-compressed bytes (a
    // JPEG, an MP4, most of what a file manager holds) BIGGER, and a zip that inflates its own
    // contents is a bug users can see.
    let method = STORE;
    let payload = raw;
    if (!isDir && raw.length) {
      const packed = await deflate(raw);
      if (packed.length < raw.length) {
        method = DEFLATE;
        payload = packed;
      }
    }

    const offset = body.length;
    body.u32(0x04034b50); // local file header
    body.u16(20); // version needed
    body.u16(UTF8_FLAG);
    body.u16(method);
    body.u16(time);
    body.u16(date);
    body.u32(sum);
    body.u32(payload.length);
    body.u32(raw.length);
    body.u16(name.length);
    body.u16(0); // extra field length
    body.push(name);
    body.push(payload);

    central.u32(0x02014b50); // central directory header
    central.u16(20); // version made by
    central.u16(20); // version needed
    central.u16(UTF8_FLAG);
    central.u16(method);
    central.u16(time);
    central.u16(date);
    central.u32(sum);
    central.u32(payload.length);
    central.u32(raw.length);
    central.u16(name.length);
    central.u16(0); // extra
    central.u16(0); // comment
    central.u16(0); // disk number
    central.u16(0); // internal attrs
    central.u32(isDir ? 0x10 : 0); // external attrs: the MS-DOS directory bit
    central.u32(offset);
    central.push(name);
  }

  const cd = central.merge();
  const out = new Bytes();
  out.push(body.merge());
  const cdOffset = out.length;
  out.push(cd);
  out.u32(0x06054b50); // end of central directory
  out.u16(0); // this disk
  out.u16(0); // disk with the central directory
  out.u16(entries.length);
  out.u16(entries.length);
  out.u32(cd.length);
  out.u32(cdOffset);
  out.u16(0); // comment length
  return out.merge();
}

// ── reading ──────────────────────────────────────────────────────────────────

export interface ZipListing {
  path: string;
  size: number; // uncompressed
  packed: number; // compressed
  offset: number; // of the local header
  method: number;
  crc: number;
}

const u16 = (v: DataView, at: number): number => v.getUint16(at, true);
const u32 = (v: DataView, at: number): number => v.getUint32(at, true);

/**
 * List an archive's entries, without inflating any of them. Reading a 300 MB zip's contents
 * into memory to show a file list would defeat the point of showing it.
 *
 * Throws if this is not a ZIP — the caller decides what to tell the user.
 */
export function listZip(bytes: Uint8Array): ZipListing[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record is LAST, and may be followed by a comment of up to
  // 64k — so it is found by scanning backwards for the signature, not by a fixed offset.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive');

  const count = u16(view, eocd + 10);
  let at = u32(view, eocd + 16); // central directory offset
  const out: ZipListing[] = [];
  const dec = new TextDecoder();

  for (let i = 0; i < count; i++) {
    if (u32(view, at) !== 0x02014b50) throw new Error('Damaged ZIP: bad central directory');
    const nameLen = u16(view, at + 28);
    const extraLen = u16(view, at + 30);
    const commentLen = u16(view, at + 32);
    out.push({
      method: u16(view, at + 10),
      crc: u32(view, at + 16),
      packed: u32(view, at + 20),
      size: u32(view, at + 24),
      offset: u32(view, at + 42),
      path: dec.decode(bytes.subarray(at + 46, at + 46 + nameLen)),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Read ONE entry's bytes. The CRC is checked: a zip whose bytes have rotted must fail loudly,
 * not hand back silent garbage that then gets written into the user's file system.
 */
export async function readZipEntry(bytes: Uint8Array, entry: ZipListing): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.offset;
  if (u32(view, at) !== 0x04034b50) throw new Error(`Damaged ZIP: no header for ${entry.path}`);
  // The local header's name and extra lengths are its OWN — an archiver may write a different
  // extra field here than in the central directory, so they cannot be reused from the listing.
  const start = at + 30 + u16(view, at + 26) + u16(view, at + 28);
  const raw = bytes.subarray(start, start + entry.packed);

  let data: Uint8Array;
  if (entry.method === STORE) data = raw;
  else if (entry.method === DEFLATE) data = await inflate(raw);
  else throw new Error(`Unsupported compression in ${entry.path}`);

  if (crc32(data) !== entry.crc) throw new Error(`Damaged ZIP: ${entry.path} failed its checksum`);
  return data;
}

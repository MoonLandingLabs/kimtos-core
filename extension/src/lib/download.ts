// Shared "save a file" helpers — trigger a browser download without leaving the
// page. Used by any app that exports text, blobs, or stored files.

function trigger(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

// Download a Blob. The temporary object URL is revoked on a delay (not right
// after the click) so the browser has started consuming it first — revoking
// synchronously can cancel/flake the download in some browsers.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  trigger(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// Download a string as a file (defaults to plain text).
export function downloadText(text: string, filename: string, type = 'text/plain'): void {
  downloadBlob(new Blob([text], { type }), filename);
}

// Download from an already-built URL (e.g. a cached IndexedDB object URL owned by
// the data store). The URL is NOT revoked — its owner manages its lifetime.
export function downloadUrl(url: string, filename: string): void {
  trigger(url, filename);
}

// Make a string safe to use as a filename: strip path separators and characters
// illegal on common filesystems. Falls back when the result is empty.
export function safeFilename(name: string, fallback = 'file'): string {
  return (name || '').replace(/[\\/:*?"<>|]+/g, '-').trim() || fallback;
}

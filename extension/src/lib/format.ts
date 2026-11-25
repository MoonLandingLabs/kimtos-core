// Shared formatting helpers.

// "Jun 8, 14:30" — compact local date+time for history rows etc.
export const formatWhen = (at: number | string | Date): string =>
  new Date(at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

// "512 KB" / "3.4 MB" — human file size (empty string for 0/undefined).
export function formatSize(bytes: number | undefined | null): string {
  if (!bytes) return '';
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

// "1:05" — mm:ss from a millisecond duration.
export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// First letter of a name, uppercased — the monogram fallback for app/icon tiles.
export const monogram = (name: string): string => name.trim().charAt(0).toUpperCase();

// "3 items" / "1 item" — a count with its pluralized noun.
export const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

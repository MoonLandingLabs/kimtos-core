// Save a stored PDF back out to the user's disk.
//
// Shared by the reading-list row and the reader toolbar so the two name the file
// and report a failure identically — the same reason a row's delete goes through
// `bulkSelect.deleteOne` rather than the store.
//
// It is READ-ONLY: it resolves the stored blob to an object URL and hands it to
// `downloadUrl`, which deliberately does NOT revoke it, because that URL is owned
// and cached by the data store. Nothing here touches the book record, its
// annotations, or the blob.

import { fileUrl } from '../../lib/api.js';
import { downloadUrl, safeFilename } from '../../lib/download.js';
import { showSnackbar } from '../../components/snackbar.js';

export interface SavableBook {
  id: string;
  title?: string;
}

/** The title is what the user sees, so it is what the saved file is named. A URL
 *  import falls back to the last path segment, which usually already ends in
 *  ".pdf" — strip that so the file does not land as "paper.pdf.pdf". */
export function pdfFilename(title?: string): string {
  return `${safeFilename((title || '').replace(/\.pdf$/i, '').trim(), 'document')}.pdf`;
}

/** Download one book's PDF. Resolves true once the download has been triggered,
 *  false if the file could not be read — in which case the user is TOLD, rather
 *  than left with a button that silently does nothing. `owner` is the app root,
 *  so the message shows in a popped-out window rather than behind it (#85). */
export async function saveBookToDisk(book: SavableBook, owner?: Element | null): Promise<boolean> {
  try {
    const url = (await fileUrl(`books/${book.id}/file`)) as string;
    downloadUrl(url, pdfFilename(book.title));
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    showSnackbar(`Couldn't download “${book.title || 'that PDF'}”: ${msg}`, { owner });
    return false;
  }
}

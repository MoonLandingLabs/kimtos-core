// A page's favicon, served by the browser itself.
//
// `chrome-extension://<id>/_favicon/?pageUrl=<page>` (the `favicon` permission) answers from the
// browser's own favicon cache, so showing a tab's icon makes NO request to the site it belongs
// to. The old way, `<img src="https://site/favicon.ico">`, made the extension page contact every
// site in the user's tab list, which the content-security policy no longer allows.

type Runtime = { getURL?: (path: string) => string };

/** The browser-cached favicon URL for a page, or null when there is none to show (not an
 *  http(s) page, or no extension runtime, as under `vite dev` and in tests). */
export function faviconUrl(pageUrl: string | undefined, size = 32): string | null {
  if (!pageUrl || !/^https?:\/\//i.test(pageUrl)) return null;
  const rt = (globalThis as { chrome?: { runtime?: Runtime } }).chrome?.runtime;
  const base = rt?.getURL?.('/_favicon/');
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}

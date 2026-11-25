// PDF export for notes — render already-rendered markdown HTML to PDF via the
// browser's own print-to-PDF engine (offscreen iframe → print dialog → "Save as
// PDF"). Stays fully on-device and preserves headings, lists, tables and
// syntax-highlighted code.

// Light syntax theme as a raw string — injected only into the print/PDF document
// (where a dark code background would be dropped by "Save as PDF").
import githubLightCss from 'highlight.js/styles/github.css?inline';
import { escapeHtml } from '../../lib/dom.js';

// `inner` is the already-rendered HTML; `title` becomes the document/file name.
export function printHtml(title: string, inner: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  // Offscreen but with a real A4-ish layout box, so the frame paginates properly.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;';
  document.body.append(frame);

  const doc = frame.contentDocument!;
  doc.open();
  doc.write(
    // The title is a page/collection NAME — free text, so it is escaped rather than
    // written raw. `<title>` is RCDATA: an unescaped `</title>` in a name would close
    // the element early and spill the rest of the name into the document.
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
      `<body><main class="md-preview doc-print">${inner}</main></body></html>`,
  );
  doc.close();

  // Carry over the app's stylesheets (absolute URLs resolve inside the iframe),
  // then the light code theme and a print-tuned base so the PDF reads cleanly.
  document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]').forEach((l) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = l.href;
    doc.head.append(link);
  });
  document.querySelectorAll('style').forEach((s) => {
    const style = doc.createElement('style');
    style.textContent = s.textContent;
    doc.head.append(style);
  });
  const print = doc.createElement('style');
  print.textContent =
    `${githubLightCss}\n` +
    // margin:0 removes Chrome's injected header/footer (URL · date · page n/n);
    // page margins are recreated with padding below instead.
    '@page { margin: 0; }' +
    // Neutralize the app shell's full-screen layout (html/body height:100% +
    // overflow:hidden) so the document flows across as many pages as needed.
    // `color-scheme:light` for the same reason as the forced white background: the
    // stylesheets copied in above carry the app's own scheme (#1160), and a print
    // document must not follow the app's theme — a PDF is paper, always light.
    // It needs `!important` like its neighbours: base.css sets the scheme on `:root`,
    // whose specificity beats the `html` type selector here, so without it the app's
    // dark scheme wins and the browser tints the printed page's controls and canvas.
    'html,body{height:auto!important;min-height:0!important;max-height:none!important;' +
    'overflow:visible!important;background:#fff!important;margin:0!important;color-scheme:light!important;}' +
    '.doc-print{height:auto!important;max-height:none!important;overflow:visible!important;' +
    'max-width:none;color:#1f2328;font-size:12pt;line-height:1.6;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:15mm;}' +
    // Collection export: each note is its own sheet with its own margins, so drop
    // the wrapper padding and let the page sections carry it.
    '.doc-print:has(.doc-print-page){padding:0;}' +
    '.doc-print-page{padding:15mm;break-after:page;}' +
    '.doc-print-page:last-child{break-after:auto;}' +
    // `.md-preview > :first-child` only reaches the section, so each page's heading
    // kept its top margin and started a fraction lower than the page above (#1166).
    '.doc-print-page > :first-child{margin-top:0;}' +
    '.doc-print h1,.doc-print h2,.doc-print h3,.doc-print h4{color:#111;}' +
    '.doc-print a{color:#0969da;text-decoration:underline;}' +
    '.doc-print pre{white-space:pre-wrap;word-break:break-word;break-inside:avoid;}' +
    // A scroll container cannot scroll on paper — it clips. The rendered-Markdown table
    // wrapper (#1171) is only a scroll box on screen, so it is opened up here, leaving
    // the printed table exactly as it was before that wrapper existed. Same reflex as
    // the `pre` rule above, which unwraps code for the same reason.
    '.doc-print .md-table-scroll{overflow:visible;}' +
    '.doc-print img,.doc-print pre,.doc-print table{break-inside:avoid;}';
  doc.head.append(print);

  const win = frame.contentWindow!;
  const cleanup = (): void => frame.remove();
  win.addEventListener('afterprint', cleanup, { once: true });
  // Fallback removal in case afterprint never fires (dialog dismissed oddly).
  setTimeout(cleanup, 120000);
  // Give the stylesheets a tick to load before opening the print dialog.
  setTimeout(() => {
    win.focus();
    win.print();
  }, 250);
}

// A brief, page-injected confirmation, in its own shadow root so the page's CSS cannot touch it
// and vice-versa. Lifted out of clipboardCapture.ts when the picker needed the same thing to say
// "Image copied" — one toast, not two copies of the same 25 lines.

import { brandMark } from './brand.js';
import { CONTENT_THEME_CSS, themeShadowHost } from '../lib/contentTheme.js';

let host: HTMLElement | null = null;
let timer: number | undefined;

export function showToast(message: string): void {
  if (!document.body) return;
  if (!host) {
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;pointer-events:none;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      CONTENT_THEME_CSS +
      '.t{display:flex;align-items:center;gap:9px;font:600 13px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
      'color:var(--kt-text);background:var(--kt-panel);border:1px solid var(--kt-hairline);padding:9px 14px;border-radius:999px;' +
      'box-shadow:var(--kt-shadow);opacity:0;transform:translateY(10px);transition:opacity .2s,transform .2s;white-space:nowrap}' +
      '.t.show{opacity:1;transform:translateY(0)}' +
      '</style>' +
      `<div class="t">${brandMark(16)}<span class="msg"></span></div>`;
    // The toast host is a singleton that outlives every message, so this follows for as long as
    // the page does; there is no teardown path to unsubscribe from.
    themeShadowHost(host);
    document.body.appendChild(host);
  }
  const t = host.shadowRoot?.querySelector('.t') as HTMLElement | null;
  const msg = host.shadowRoot?.querySelector('.msg') as HTMLElement | null;
  if (!t || !msg) return;
  msg.textContent = message; // textContent, not innerHTML — this string reaches a page we do not own
  t.classList.add('show');
  clearTimeout(timer);
  timer = window.setTimeout(() => t.classList.remove('show'), 1400);
}

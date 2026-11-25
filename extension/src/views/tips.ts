// Tips — a muted line under the app dock that rotates through a tip every 5s.

import { tips } from '../data/tips.js';

let timer: ReturnType<typeof setInterval> | null = null;

export function stopDockTip(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function renderDockTip(el: HTMLElement): void {
  stopDockTip();
  if (!tips.length) {
    el.textContent = '';
    return;
  }
  let i = 0;
  const swap = (): void => {
    el.classList.add('is-fading');
    setTimeout(() => {
      el.textContent = tips[i % tips.length];
      i += 1;
      el.classList.remove('is-fading');
    }, 280);
  };
  el.textContent = tips[0];
  i = 1;
  timer = setInterval(swap, 5000);
}

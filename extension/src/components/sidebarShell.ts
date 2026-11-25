import { el } from '../lib/dom.js';
import { createResizer } from './resizer.js';
import { makeSidebarResponsive } from './sidebarResponsive.js';

// The shared "history sidebar + main pane" layout used by every app that pairs a
// createHistorySidebar with a result/flow area (media-text factory, denoise,
// vidrec, kimtai). Builds the `mt-layout` row, sizes the sidebar, wires the drag
// resizer, and makes it responsive (collapses on narrow windows).
//
// Returns { layout, main, sidebarEl, resizer, responsive }.
interface SidebarShellOptions {
  history: { el: HTMLElement };
  reserve: number;
  width?: number;
  label?: string;
  onResize?: (width: number) => void;
}

export function createSidebarShell({ history, reserve, width = 220, label, onResize }: SidebarShellOptions) {
  const layout = el('div', 'mt-layout');
  const sidebarEl = history.el;
  sidebarEl.style.width = `${width}px`;
  const resizer = createResizer({ layout, pane: sidebarEl, reserve, onResize });
  const main = el('div', 'app-flow mt-main');
  layout.append(sidebarEl, resizer, main);
  const responsive = makeSidebarResponsive({ layout, sidebar: sidebarEl, label });
  return { layout, main, sidebarEl, resizer, responsive };
}

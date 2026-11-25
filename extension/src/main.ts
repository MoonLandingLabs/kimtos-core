import './styles/main.css';
import { startApp } from './controllers/appController.js';
import { Z_INDEX } from '@kimtos/config/ui';

// Mirror the z-index tokens (single source: @kimtos/config/ui) into CSS custom
// properties, so stylesheets use var(--z-*) and never drift from dialog.ts.
{
  const s = document.documentElement.style;
  s.setProperty('--z-rail', String(Z_INDEX.rail));
  s.setProperty('--z-dock', String(Z_INDEX.dock));
  s.setProperty('--z-app-window', String(Z_INDEX.appWindow));
  s.setProperty('--z-utility-dialog', String(Z_INDEX.utilityDialog));
  s.setProperty('--z-confirm', String(Z_INDEX.confirm));
}

// After the extension updates/rebuilds, an already-open new-tab page still
// references the previous build's content-hashed chunks (e.g. grammar-XXXX.js).
// Those files are gone, so the next lazy import() 404s ("Failed to fetch
// dynamically imported module"). Reload once to pick up the current chunks; a
// session flag prevents a reload loop if a chunk is genuinely missing.
window.addEventListener('vite:preloadError', (e) => {
  if (sessionStorage.getItem('kimtos:reloaded-stale')) return; // already retried — let it fail
  sessionStorage.setItem('kimtos:reloaded-stale', '1');
  e.preventDefault();
  window.location.reload();
});
// Once a load survives a few seconds, the chunks are current — clear the guard so
// a later update can auto-recover again (without this firing on the reload itself).
setTimeout(() => sessionStorage.removeItem('kimtos:reloaded-stale'), 5000);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void startApp());
} else {
  void startApp();
}

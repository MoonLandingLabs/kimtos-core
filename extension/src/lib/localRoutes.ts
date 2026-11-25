// Eager-loads every `*.local.{js,ts}` so its routes self-register before any API
// call. Drop a `<id>.local.js`/`.ts` next to an app (or in `src/local/`) and it's
// picked up automatically — same auto-discovery spirit as the dock apps.
import.meta.glob('/src/**/*.local.{js,ts}', { eager: true });

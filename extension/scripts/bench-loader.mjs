// Redirects the app registry (Vite `import.meta.glob`) to a Node-loadable stub. Nothing else is
// intercepted: agentTools.ts, the prompt and the parser all load as they ship.
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUB = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'bench-apps-stub.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (/apps\/(index|metaIndex)\.(js|ts)$/.test(specifier)) {
    return { url: STUB, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}

// Vite also injects `import.meta.env`. In Node it is undefined, and `backend.ts` reads it at
// module scope. Substitute an empty object so the module's own defaults apply — this changes no
// behaviour under measurement (the bench never calls the backend).
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (result.source && url.includes('/src/')) {
    const src = String(result.source);
    if (src.includes('import.meta.env')) {
      result.source = src.replaceAll('import.meta.env', '(globalThis.__VITE_ENV__ ?? {})');
    }
  }
  return result;
}

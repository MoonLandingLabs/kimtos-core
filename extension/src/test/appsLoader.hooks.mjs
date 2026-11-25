// The resolve hook itself. `initialize` receives the stub URL from appsLoader.mjs.
let STUB = '';

export function initialize(data) {
  STUB = data.stub;
}

// Vite turns `import './x.css'` into a side effect that injects a stylesheet. Node cannot load a
// .css file at all, and it is the FIRST line of every app — so a single unhandled import made every
// app module, and anything importing one, untestable. There is nothing to assert about a stylesheet
// in a headless DOM, so it resolves to an empty module.
const EMPTY = 'data:text/javascript,export default {}';

export async function resolve(specifier, context, nextResolve) {
  if (/apps\/(index|metaIndex)\.(js|ts)(\?.*)?$/.test(specifier)) {
    return { url: STUB, shortCircuit: true, format: 'module' };
  }
  if (/\.css(\?.*)?$/.test(specifier)) {
    return { url: EMPTY, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}

// Vite also injects `import.meta.env`, which Node leaves undefined — and some modules read it
// at module scope. Substitute an empty object so the module's own defaults apply.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!result.source || !url.includes('/src/')) return result;
  let src = String(result.source);

  // `import.meta.env` is Vite's, and backend.ts reads it at module scope. An empty object lets the
  // module's own defaults apply.
  if (src.includes('import.meta.env')) {
    src = src.replaceAll('import.meta.env', '(globalThis.__VITE_ENV__ ?? {})');
  }

  // `import.meta.glob` is Vite's bundler globbing — it does not exist in Node, and three more
  // modules use it (the wallpaper list, the local-API route registry, the app registry). The two
  // registry modules are redirected above; for the rest, globbing simply finds nothing, which is
  // the honest answer: there is no bundler here. A test that needs those modules supplies them.
  if (src.includes('import.meta.glob')) {
    src = src.replaceAll('import.meta.glob', '(() => ({}))');
  }

  result.source = src;
  return result;
}

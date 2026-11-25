// A tiny client-side "router" so local app handlers can register REST-style
// routes. `lib/api.js` dispatches `getApi`/`jsonApi`/`callApi`/`fileUrl` calls
// here — everything runs in the browser, nothing leaves the device.
//
// Handlers receive a context `{ params, query, body, form }` and return a plain
// JSON-serialisable value. Use the pseudo-method `FILE` for routes that resolve
// to an object URL (e.g. a stored PDF or wallpaper).

export interface HandlerContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  form?: FormData;
}
export type RouteHandler = (ctx: HandlerContext) => unknown;

interface Route {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: RouteHandler;
}

const routes: Route[] = [];

function compile(pattern: string): { regex: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${source}$`), keys };
}

export function register(method: string, pattern: string, handler: RouteHandler): void {
  const { regex, keys } = compile(pattern);
  routes.push({ method, regex, keys, handler });
}

function split(endpoint: string): { path: string; query: Record<string, string> } {
  const [rawPath, qs] = endpoint.split('?');
  return {
    path: (rawPath ?? '').replace(/^\/+/, ''),
    query: Object.fromEntries(new URLSearchParams(qs || '')),
  };
}

interface Match {
  route: Route;
  params: Record<string, string>;
  query: Record<string, string>;
}

function match(method: string, endpoint: string): Match | null {
  const { path, query } = split(endpoint);
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.regex.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, i) => {
      params[key] = decodeURIComponent(m[i + 1] ?? '');
    });
    return { route, params, query };
  }
  return null;
}

export function hasRoute(method: string, endpoint: string): boolean {
  return match(method, endpoint) !== null;
}

export async function dispatch(
  method: string,
  endpoint: string,
  { body, form }: { body?: unknown; form?: FormData } = {},
): Promise<unknown> {
  const found = match(method, endpoint);
  if (!found) throw new Error(`No local handler for ${method} ${endpoint}`);
  return found.route.handler({ params: found.params, query: found.query, body, form });
}

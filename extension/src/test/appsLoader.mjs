// Redirects the two Vite-glob modules to a Node-loadable stub, so a test can import a view or a
// controller at all. Registered by the `test` script; nothing else is intercepted.
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const STUB = pathToFileURL(join(here, 'appsRegistry.stub.mjs')).href;

register(pathToFileURL(join(here, 'appsLoader.hooks.mjs')).href, pathToFileURL('./'), { data: { stub: STUB } });

// Boot every dev server, wait for it to actually come up, then kill it.
//
//   node scripts/smoke-dev.mjs          # all surfaces
//   node scripts/smoke-dev.mjs www      # just one
//   make smoke
//
// Nothing else in CI does this. Every other job builds (`nuxt generate`, `vite
// build`, `vitepress build`) — and a dev server can be comprehensively broken
// while every build stays green. That is not hypothetical: it is how #111
// shipped (`make www` died on a missing @kimtos/config dist, CI green) and how
// #149 shipped (Nuxt's dev server dies inside Node's module loader on Node 24,
// `nuxt generate` unaffected).
//
// The trap this must not fall into: a half-dead dev server PRINTS ITS URL and
// then fails. #149's output announced "Local: http://localhost:8799/" and only
// then crashed. So "the port was logged" and "the process is still alive" are
// both worthless as readiness signals — we wait for the line each tool prints
// only once it has really built, then watch a settle window for a late error.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// `ready` is the line the tool prints only after its builder is up — NOT the
// line announcing the port, which is printed before the work that can fail.
const SURFACES = [
  { name: 'extension', pkg: '@kimtos/extension', tool: 'vite', ready: /ready in \d/i },
  { name: 'www', pkg: '@kimtos/www', tool: 'nuxt dev', ready: /Vite client built/i },
  { name: 'docs', pkg: '@kimtos/www-docs', tool: 'vitepress dev', ready: /Local:\s+http/i },
];

const FAILED = /\bERROR\b|builder failed|Cannot find module|Failed to load/i;
const BOOT_TIMEOUT_MS = 180_000; // a cold nuxt dev on a CI runner is not fast
const SETTLE_MS = 3_000; // ready is not enough — watch for a late crash

// These tools colour their output, and the escapes land INSIDE the phrases we
// match: vite prints "ready in \x1b[1m910\x1b[22m ms", vitepress breaks up
// "Local:". Matching the raw stream silently never fires, and every surface
// then "times out" while visibly running. NO_COLOR is not enough on its own.
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function smoke({ name, pkg, ready }) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'dev', '-w', pkg], {
      cwd: ROOT,
      detached: true, // own process group, so we can kill the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', CI: '1' },
    });

    let log = '';
    let settled = false;
    let timer;

    const done = (ok, reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.kill(-child.pid, 'SIGKILL'); // negative pid: the group, not just npm
      } catch {
        /* already gone */
      }
      resolve({ name, ok, reason, log });
    };

    const onData = (chunk) => {
      log += stripAnsi(String(chunk));
      if (FAILED.test(log)) return done(false, 'logged an error');
      if (ready.test(log) && !timer) {
        // Came up. Now hold it open — a server that dies 200ms later is not up.
        timer = setTimeout(() => {
          if (FAILED.test(log)) return done(false, 'errored after starting');
          done(true);
        }, SETTLE_MS);
      }
    };

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => done(false, `could not spawn: ${err.message}`));
    child.on('exit', (code) => done(false, `exited with code ${code} before it was ready`));

    setTimeout(() => done(false, `never became ready within ${BOOT_TIMEOUT_MS / 1000}s`), BOOT_TIMEOUT_MS);
  });
}

const only = process.argv[2];
const surfaces = only ? SURFACES.filter((s) => s.name === only) : SURFACES;
if (!surfaces.length) {
  console.error(`unknown surface "${only}" — known: ${SURFACES.map((s) => s.name).join(', ')}`);
  process.exit(1);
}

console.log(`Dev servers (node ${process.versions.node})\n`);
const failures = [];

// Sequentially: four dev servers at once starve a CI runner and make the boot
// timeout meaningless.
for (const surface of surfaces) {
  const result = await smoke(surface);
  const label = `${surface.name.padEnd(10)} ${surface.tool.padEnd(14)}`;
  if (result.ok) {
    console.log(`  ${label} OK`);
  } else {
    console.log(`  ${label} FAILED — ${result.reason}`);
    failures.push(result);
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`\n--- ${failure.name}: ${failure.reason} ---\n${failure.log.trimEnd()}`);
  }
  console.error(`\n${failures.length} dev server(s) failed to start.`);
  process.exit(1);
}
console.log(`\nAll ${surfaces.length} dev servers started.`);

// Exit NOW, do not fall off the end and let the event loop drain. Each surface was
// SIGKILLed, but Vite/Nuxt/Nitro spawn worker subprocesses (esbuild service, deps
// optimiser) that escape the killed process group or keep a pipe open to us, so Node
// otherwise waits ~3 minutes for those handles to close before it exits — pure dead
// time added to every green run. The work is done and verified by the time we get
// here; mirror the failure path's explicit exit instead of hanging on orphans.
process.exit(0);

#!/usr/bin/env node
// Fails the build if the extension manifest declares a permission Chrome does not
// grant an extension.
//
// Nothing else reads these keys. The manifest is hand-authored, no bundler validates
// it, and eslint/tsc never open it — so the FIRST thing that checks a permission name
// is Chrome, at load time, long after CI is green. That is exactly how `audioCapture`
// and `videoCapture` shipped to main (#1335): both are Chrome APPS permissions, and
// every load of the extension answered with
//
//   'audioCapture' is only allowed for packaged apps, but this is a extension.
//
// They had passed lint, typecheck, 26 other guards, a three-round review and a merge,
// because none of those can see a manifest key.
//
// The list below is Chrome's documented extension permission list:
// https://developer.chrome.com/docs/extensions/reference/permissions-list
// It is an ALLOW-list on purpose. A deny-list of the known Apps-only keys would have
// caught this one bug and nothing else — not a typo, not the next Apps key someone
// borrows from a Stack Overflow answer written for a packaged app.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'extension', 'manifest.json');

/** Every permission Chrome documents for an extension. */
export const EXTENSION_PERMISSIONS = new Set([
  'accessibilityFeatures.modify',
  'accessibilityFeatures.read',
  'activeTab',
  'alarms',
  'audio',
  'background',
  'bookmarks',
  'browsingData',
  'certificateProvider',
  'clipboardRead',
  'clipboardWrite',
  'contentSettings',
  'contextMenus',
  'cookies',
  'debugger',
  'declarativeContent',
  'declarativeNetRequest',
  'declarativeNetRequestFeedback',
  'declarativeNetRequestWithHostAccess',
  'desktopCapture',
  'dns',
  'documentScan',
  'downloads',
  'downloads.open',
  'downloads.ui',
  'enterprise.deviceAttributes',
  'enterprise.hardwarePlatform',
  'enterprise.networkingAttributes',
  'enterprise.platformKeys',
  'favicon',
  'fileBrowserHandler',
  'fileSystemProvider',
  'fontSettings',
  'gcm',
  'geolocation',
  'history',
  'identity',
  'identity.email',
  'idle',
  'loginState',
  'management',
  'nativeMessaging',
  'notifications',
  'offscreen',
  'pageCapture',
  'platformKeys',
  'power',
  'printerProvider',
  'printing',
  'printingMetrics',
  'privacy',
  'processes',
  'proxy',
  'readingList',
  'runtime',
  'scripting',
  'search',
  'sessions',
  'sidePanel',
  'storage',
  'system.cpu',
  'system.display',
  'system.memory',
  'system.storage',
  'tabCapture',
  'tabGroups',
  'tabs',
  'topSites',
  'tts',
  'ttsEngine',
  'unlimitedStorage',
  'userScripts',
  'vpnProvider',
  'wallpaper',
  'webAuthenticationProxy',
  'webNavigation',
  'webRequest',
  'webRequestBlocking',
]);

/**
 * Chrome Apps permissions people reach for in an extension, and what to do instead.
 * Only here to make the failure message useful — an unknown key fails either way.
 */
export const APP_ONLY = {
  audioCapture: 'there is no manifest permission for the microphone; call getUserMedia and handle the refusal',
  videoCapture: 'there is no manifest permission for the camera; call getUserMedia and handle the refusal',
  fileSystem: 'use the File System Access API from a page',
  mediaGalleries: 'no extension equivalent',
  serial: 'use the Web Serial API from a page',
  socket: 'no extension equivalent',
  syncFileSystem: 'no extension equivalent',
  usb: 'use WebUSB from a page',
};

/**
 * Every declared permission that Chrome will not honour for an extension.
 *
 * Host permissions are NOT checked here: they are match patterns, not names, and
 * `check-network-hosts.mjs` already owns them.
 *
 * @param {{permissions?: unknown, optional_permissions?: unknown}} manifest
 * @returns {{key: string, field: string}[]} the offenders, in declaration order
 */
export function invalidPermissions(manifest) {
  const bad = [];
  for (const field of ['permissions', 'optional_permissions']) {
    const declared = manifest[field];
    if (!Array.isArray(declared)) continue;
    for (const key of declared) {
      if (typeof key === 'string' && !EXTENSION_PERMISSIONS.has(key)) bad.push({ key, field });
    }
  }
  return bad;
}

// Importable for the tests; only the direct run exits.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(FILE, 'utf8'));
  const bad = invalidPermissions(manifest);

  if (bad.length) {
    console.error(`extension/manifest.json declares ${bad.length} permission(s) Chrome does not grant an extension:`);
    for (const { key, field } of bad) {
      const why = APP_ONLY[key]
        ? `a Chrome Apps permission — ${APP_ONLY[key]}`
        : 'not in Chrome’s extension permission list (a typo, or an Apps/Firefox key)';
      console.error(`  ${field}: "${key}" — ${why}`);
    }
    console.error(
      'Chrome warns on every load and ignores the key. If Chrome has since documented it, ' +
        'add it to EXTENSION_PERMISSIONS in scripts/check-manifest-permissions.mjs:\n' +
        '  https://developer.chrome.com/docs/extensions/reference/permissions-list',
    );
    process.exit(1);
  }

  const count = (manifest.permissions?.length ?? 0) + (manifest.optional_permissions?.length ?? 0);
  console.log(`check-manifest-permissions: ${count} declared permission(s), all valid for an extension`);
}

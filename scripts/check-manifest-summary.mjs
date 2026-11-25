// Fails the build if the extension manifest's description cannot be a Chrome Web
// Store summary.
//
// The store shows the manifest `description` as the listing's summary, and hard-caps
// it at 132 characters — an upload whose description is longer is REJECTED at
// submission time, which turns a routine release into a failed one (and the release
// workflow only finds out after the tag is pushed). A 140-character description sat
// on main until the Featured-badge audit caught it by hand; the length is checked
// nowhere else, because the manifest is hand-authored and no bundler reads the field.
//
// The cap is Google's, not ours: https://developer.chrome.com/docs/webstore/best_listing

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', 'extension', 'manifest.json');
const LIMIT = 132;

const { description } = JSON.parse(readFileSync(FILE, 'utf8'));

if (typeof description !== 'string' || description.trim() === '') {
  console.error('extension/manifest.json has no description — the store requires one.');
  process.exit(1);
}

if (description.length > LIMIT) {
  console.error(
    `extension/manifest.json description is ${description.length} characters; the ` +
      `Chrome Web Store caps the summary it becomes at ${LIMIT}. The upload would be ` +
      `rejected at submission. Shorten it by ${description.length - LIMIT}.`,
  );
  process.exit(1);
}

console.log(`check-manifest-summary: description is ${description.length}/${LIMIT} characters`);

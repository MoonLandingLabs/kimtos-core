# Privacy policy

_Last updated: 2026-11-25. Applies to the Kimtos browser extension, version 1.0.3 and later._

Kimtos is a free, open-source Chrome extension. It has no accounts, no backend and no servers
of its own. This policy describes exactly what it does with your data, and the source code in
this repository is the authoritative record.

## What Kimtos collects

Nothing. Kimtos does not collect, transmit, sell or share any personal data, usage data,
analytics or telemetry. There are no advertising or tracking identifiers.

## Where your data lives

Everything you create (notes, tasks, PDFs, files, boards, recordings, clipboard history,
settings) is stored in your own browser, in IndexedDB and `chrome.storage.local`. It never
leaves your device. Uninstalling the extension or clearing its data removes it.

## Network requests

Kimtos makes no network request except the on-device AI model downloads that you start, from
Hugging Face (`huggingface.co` and its content-delivery hosts under `hf.co`). Those requests
fetch public model files. They carry no content you wrote, and Hugging Face can see the usual
connection details (such as your IP address) that any website sees. The extension's manifest and
content security policy allow those hosts and no others, and an automated test fails if that
ever widens. Once a model is downloaded, it runs fully offline.

Links you choose to click (for example Report an issue, Documentation or a rate-and-review link)
open in a normal browser tab and are governed by the destination site's own policy.

## Permissions

Each permission is requested for one purpose, listed in
[`docs/extension/chrome-web-store.md`](docs/extension/chrome-web-store.md). In short: local
storage, the new-tab page, the side panel, context-menu actions, the browser's own favicon
cache, and, only if you turn on Grammit, Clipboard or FakeForm, permission to run on the pages
you use them on. Page access is requested at runtime, never at install. It lets the extension
read those pages. It does not let it send anything anywhere.

## Microphone and camera

The recording and voice apps use your microphone or camera only when you press Record, through
the browser's standard permission prompt. Audio and video stay on your device.

## Children

Kimtos is a general-purpose tool and collects no data from anyone, including children.

## Changes and contact

Changes to this policy are made in this repository and are visible in its history. Questions
and reports go to the [issue tracker](https://github.com/MoonLandingLabs/kimtos-core/issues).
Security problems: see [SECURITY.md](SECURITY.md).

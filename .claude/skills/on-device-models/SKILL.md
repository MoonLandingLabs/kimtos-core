---
name: on-device-models
description: >-
  How kimtos runs on-device AI models (Transformers.js/ONNX in web workers, WASM + WebGPU) and the
  rules for adding, changing or removing one — especially the KimtAI chat catalog. Covers the
  Apache/MIT-ONLY licensing rule (no Gemma, no Llama-licensed models), how to verify a real ONNX
  repo, the resource metadata + pre-download gate, the MANDATORY in-browser verification before
  release (a model can look fine and emit garbage), the dormant-agent convention, and the
  small-model system-prompt caveats. Use whenever touching an engine, a model catalog, dtype, or
  THIRD-PARTY-NOTICES for a model. Trigger on: "add a model", "KimtAI model", "Transformers.js",
  "ONNX", "kimtaiModels", "engine", "dtype", "WebGPU", "model download", "system prompt".
---

# on-device-models — Transformers.js/ONNX models in the extension

Every AI feature runs **entirely on the user's device**, in a Web Worker, via
`@huggingface/transformers` (Transformers.js) on `onnxruntime-web` (WASM on CPU, WebGPU when
available). Nothing is uploaded. Engines live in `extension/src/lib/engines/` (`kimtai` chat,
`denoise`, `transcribe`, `grammar`, `embed`). Model weights are fetched from Hugging Face at runtime
(see `docs/extension/models.md` and `extension/src/lib/modelHosts.ts`); Kimtos runs no file host.

## The catalog is the single source of truth

- **KimtAI chat**: `extension/src/lib/engines/kimtaiModels.ts` — `MODELS: Model[]` + `DEFAULT_MODEL`.
  The docs booklet **generates its model list from this array** (add a model → docs update, no docs
  edit — that drift is #245). Other engines keep model lists in `extension/src/lib/appModels.ts`
  (`WHISPER_MODELS`, `GRAMMAR_MODELS`).
- A `Model` declares `id`, `label`, `family`, `params`, `size`, `dtype` (WebGPU), `wasmDtype` (falls
  back to `q4`), `tier`, `needsWebGPU`, `note`, plus resource fields `downloadMB`, `minRamGB`,
  `recRamGB`, `recWebGPU` (drive the pre-download warning, #269).

## LICENSING — Apache-2.0 / MIT ONLY (this is the boundary, not a preference)

kimtos is a free, open-source product that hands these weights to end users. A model
whose licence restricts what a user may do — or obliges us to pass terms on — cannot ship.

- **Allowed**: Apache-2.0, MIT, and equivalently permissive.
- **Banned, do not re-add**: **Gemma** (Google's custom Gemma Terms — use restrictions), and the
  **Llama-licensed** models (acceptable-use + naming terms). "TinyLlama" is fine — it is independent
  Apache-2.0 despite the name; the _Llama-3.x_ family is not.
- **Verify before adding** — don't trust the mirror repo's card. Check the _base_ model's licence via
  the HF API:
  ```bash
  curl -s "https://huggingface.co/api/models/<owner>/<model>" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('cardData',{}).get('license'))"
  ```
  Confirm it also has ONNX weights (`siblings` contains an `onnx/…` path). Then add a
  `THIRD-PARTY-NOTICES.md` entry (both the summary list line AND a detail section) — MIT and Apache
  both require the notice to travel with what we distribute.

## Add a model (the full checklist)

1. Verify **real ONNX repo + permissive licence** (above).
2. Add the entry to `kimtaiModels.ts` with honest resource metadata (q4 in-browser footprint).
3. Add its `THIRD-PARTY-NOTICES.md` entries.
4. **Verify it in-browser** (below) — do NOT skip.
5. Gate: `npm run lint | typecheck | format:check | test | build -w @kimtos/extension` and
   `npm run build -w @kimtos/www-docs` (the booklet regenerates from the catalog).

## MANDATORY: verify a model in a real browser before release

A model can be **coherent on a one-word reply and emit a wall of repeated/garbage tokens on any real
generation** — this is exactly how the Qwen2.5 0.5B/1.5B ONNX models shipped and had to be pulled
(#546). A green CI does NOT prove a model works; only a browser does.

```bash
npm run build -w @kimtos/extension          # produces extension/dist
# chrome://extensions → Developer mode → Load unpacked → extension/dist → open a new tab
```

In KimtAI → **Models**, download the model and send real prompts (`Write one sentence about the
ocean.`, `who are you?`) on **both** the WASM and WebGPU paths. Coherent, on-topic text = pass.
Repeated tokens / word salad = fail → tune `dtype`/`wasmDtype` and generation config, or **pull the
model** (as we did Qwen). **Known-broken: `onnx-community/Qwen2.5-0.5B-Instruct` and `1.5B` — do not
re-add without a genuinely working ONNX build proven in-browser.** SmolLM2 (360M default, 1.7B) and
TinyLlama-1.1B are verified-good.

## Every download goes through KimtManager, and says what it can do

A model download is the longest, largest thing this product does — up to a gigabyte — so it is
work the user must be able to SEE and, where possible, stop. Convention 11 in CLAUDE.md is the
rule; this is what it means for a model specifically.

**From the App Store or a settings change** — `lib/installManager.ts` registers it. Nothing to do.

**On first USE** — pressing Ask, typing, clicking a voice card, first-run setup — use
`lib/modelJob.ts`:

```ts
const embedder = await loadAsJob({ appId: appMeta.id, title: 'Downloading the search model' }, (onProgress) =>
  createEmbedder({ onProgress }),
);
```

It registers a `kind: 'download'` job, so the transfer gets a row, a percentage, a place in the
queue, and a name when a takeover or a sign-out is about to destroy it. Keep the in-app status
line too: that is where the user is already looking, and the row is for finding the work again
from anywhere else.

**Never hand-roll a second registry.** A `Map` of in-flight downloads with its own
AbortControllers is a re-implementation of the orchestrator wired into one dialog, and it is how
a gigabyte download stayed invisible to Stop all and to the takeover notice (#1275).
`scripts/check-orchestrated-jobs.mjs` fails the build on one, and it reads every `.ts` in the app,
not just `index.ts`.

### A Stop must actually stop

`ModelEntry.cancellable` (`lib/appModels.ts`) and `JobSpec.cancellable` are DECLARED, never
assumed. Declare `true` only when the download honours its signal end to end.

The assumption they replaced was "everything can stop", and it meant six installs rendered an
enabled Stop, deleted the row when pressed, and kept downloading up to 300 MB — the user believing
they had stopped it (#1302). **A Stop that lies is worse than no Stop**, so work that cannot be
interrupted offers no button (#1172). `appModels.test.ts` asserts an entry may only claim `true`
when its `download` forwards a signal, and the App Store button gates its own cancel affordance on
the same value.

Which engines honour a signal today: Denoise (via `fetchModelFile`) and KimtAI (`downloadModel`
terminates its worker). The rest own their own network and take none — #1304 maps them.

### What stopping costs, and `savesOnStop`

A stopped download keeps whole files it already fetched, but the file IN FLIGHT restarts: there is
no range request and nothing keeps a partial (`modelFetch.ts` buffers and writes once, after
validating — a bad body poisoned the cache once, #140). So `savesOnStop: false` is the honest
declaration for a download today. #1301 makes it resumable, and flips that.

## The pre-download resource gate (#269)

`extension/src/lib/deviceResources.ts` detects cores / RAM (`navigator.deviceMemory`, capped at 8) /
WebGPU / free storage, and `evaluateModelFit(model, res)` (a **pure, unit-tested** function) returns
`ok` / `caution` / `warn`. In KimtAI's download flow a `warn` shows the shortfall AND an
acknowledgement checkbox that gates the Download button. Keep new fit logic in that pure function
with tests — never inline it in the UI.

## Agent tools stay DORMANT (convention #5)

`extension/src/lib/engines/kimtai.ts` has `NATIVE_TOOL_FAMILIES = { 'Qwen', 'Llama' }`;
`supportsNativeTools(id)` is true when a model's `family` matches, which routes chat through the
agent/tool loop. No shipped model drives tools reliably, so the agent is deliberately off — **keep a
new model's `family` NOT matching that set** (use the real family, e.g. `Qwen2.5`, `TinyLlama`) so
nothing silently enables the loop. Turning tool-use on requires _proving_ a model can drive the tools
first, and CI (`check-agent-claims.mjs`) blocks any user-facing copy claiming it can.

## A tool that reaches the network needs opt-in AND disclosure, in the SAME commit (#886)

A tool hands its result straight to a model that is mid-conversation with the user, so a tool that
fetches is an outbound path for whatever the user is talking about. `web_search` was exactly that:
it posted a chat-derived query to `html.duckduckgo.com`, disclosed on neither the privacy page nor
the README, while the store listing promised the user's data never leaves their browser. It was
honest only by accident — the agent loop is dormant, so it could not fire — and adding a Qwen model
would have made it live and made the privacy page false **in that same commit**. Removed in #885.

This is now a CI contract, not advice. `scripts/check-network-hosts.mjs` fails the build when a host
reachable from a file that declares `tools` has no `optIn`, and when any declared host carries user
content without an off-by-default switch, words on the privacy page that really say so, and a named
subprocessor. Each claim is checked against the real file — the switch must exist in the app's
`settings` schema and default to off; the phrase must be on `www/pages/privacy.vue`; the
subprocessor must be in `www/data/legal.ts`. The full field list is documented at the top of
`scripts/network-hosts.mjs`, and `scripts/check-network-hosts.test.mjs` pins both directions.

So: adding a fetching tool is a **product decision with five artefacts**, not a tool declaration.
If you are not also writing the setting, the privacy copy and the subprocessor row, you are not
ready to add the tool.

## Small-model system prompt (KimtAI)

`DEFAULT_SYSTEM` in `apps/kimtai/index.ts`. Keep it **short**: a long, detailed prompt gets recited
back or ignored by a 0.36–1.7B model (#565), and an ungrounded one invents (it told users it "syncs
with your Google Account", the opposite of the truth — #552). Ground only the load-bearing facts
(on-device, offline, no lookups, brief, honest). Default temperature is **0.4** ("Balanced"), not 0.7
(#557) — lower temp keeps a small model focused. All of this is mitigation, not a cure: a sub-2B
model will still sometimes ramble/invent. The real levers are a better working model or
retrieval/tools, not more prompt words.

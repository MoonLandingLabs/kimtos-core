# Can a small on-device model call our tools?

**Every app declares agent tools, and every one of them is dormant.** `CLAUDE.md`
(convention 5) forbids claiming otherwise, and a CI check (`check-agent-claims.mjs`) enforces
it. The reason is a measurement, and this is that measurement — committed, so it can be re-run
and argued with instead of quoted from a comment.

(How many tools that is, exactly, is derived from the descriptors rather than written here —
see `scripts/agent-tool-count.mjs`. This sentence used to state the figure, and it was one of
four hand-typed copies, no two of which agreed: #1099.)

```sh
node --import tsx extension/scripts/bench-agent-tools.mjs                                   # the default model
node --import tsx extension/scripts/bench-agent-tools.mjs --model onnx-community/Qwen2.5-0.5B-Instruct --native
```

The harness imports the **production** `buildAgentSystemPrompt()` and `parseToolCall()`. If
either changes, the score changes. It measures six things a real user would ask ("what tasks do
I have today?", "add a task to buy milk", "what did I copy recently?") against five real tools,
greedy decoding, on CPU.

## Results

| Model                          | Protocol                    | Score   | No tool call | Median latency |
| ------------------------------ | --------------------------- | ------- | ------------ | -------------- |
| **SmolLM2-360M** (our default) | prompt-based (our fallback) | **1/6** | 3/6          | 24.5 s         |
| Qwen2.5-0.5B                   | prompt-based (our fallback) | **2/6** | 4/6          | 10.2 s         |
| **Qwen2.5-0.5B**               | **native tool template**    | **5/6** | 1/6          | 9.0 s          |
| Llama-3.2-1B                   | native tool template        | **4/6** | **0/6**      | 11.8 s         |

All CPU, `q4`, greedy. Llama-3.2-1B is worth a second look for one reason: it **always** called a
tool (0/6 no-call) — it never once talked _about_ the tools instead of using them. It lost its
two points by reaching for `list_tasks` when asked to _create_ a task. Qwen2.5-0.5B beats it at a
third of the size.

## What the numbers say

**1. The default model cannot do this.** SmolLM2-360M scores 1/6. It does not merely fail — it
fails _creatively_: asked to create a task, it emitted a call to `list_notes`, **a tool that does
not exist**, twice. Asked what tasks it had, it replied _"You can't do anything for the user
today"_ and called nothing.

**2. The protocol matters more than the size.** The same Qwen2.5-0.5B goes from **2/6 to 5/6**
purely by using its **native tool-calling template** instead of our hand-rolled prompt. Same
model, same tools, same questions. Our fallback asks a model to hand-write fenced JSON by
instruction-following alone, which is the hardest possible ask for a small model; a model whose
chat template was _trained_ for tool calls emits a proper tool-call block. The arguments come out
right too (`create_task({"title":"review the PR"})`, `search_notes({"query":"invoice"})`).

This confirms what #77 suspected: **the native template is the single biggest lever, and it is
already built** (`supportsNativeTools` / `toFunctionSpecs`). It has simply never had a model to
use it with — `supportsNativeTools()` looks the model up in the catalogue, and no Qwen model is
in the catalogue, so the path is dead code today.

**3. Qwen did not degenerate.** `engines/kimtai.ts` says Qwen2.5 ONNX "degenerated into
repeated/garbage tokens" and was reverted. On `onnx-community/Qwen2.5-0.5B-Instruct` at `q4` on
CPU it produced clean, coherent, correctly-argued tool calls. Whatever went wrong before was
**the export, the quantisation, or the WebGPU path — not the model.** That is worth knowing
before the next attempt.

**4. Latency is the unsolved problem.** 9-24 seconds _per turn_ on CPU. A tool call is at least
two turns (call, then answer from the result), so a single "what tasks do I have today?" is
20-50 seconds before the user sees anything. This is measured in Node on a laptop; a new-tab page
on a cold profile will not be faster. **Correctness is now the easier half of this problem.**

## What this does not settle

- **WebGPU**, which is where the real speed is, and which is the path the earlier Qwen attempt
  reportedly failed on. These numbers are CPU-only.
- **Bigger models** (1.5B-3B): a bigger model is a ~1-2 GB download, so the question is not only
  whether it scores better but whether it is shippable at all. Note that on this suite the 1B
  model did **not** beat the 0.5B one — going bigger is not obviously the answer.
- The suite is **six prompts**. It is a smoke test that separates "cannot do this" from "can",
  not a benchmark. A model that passes should be measured on far more before anything is switched
  on.

## The bug this found

`parseToolCall` **ignores its `toolNames` allowlist** on the JSON path, so a hallucinated tool
name (`list_notes`, `delete_everything`) parses as a real call. Filed as #236. It also inflates
any measurement, since inventing a tool would otherwise count as "emitted a tool call".

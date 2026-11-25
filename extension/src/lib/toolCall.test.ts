// The tool-call parser is the boundary between an UNTRUSTED MODEL and code that runs on the
// user's device. `toolNames` is passed in at every call site as if it were a gate — and on the
// JSON path, the shape our own system prompt asks the model to emit, it was built and then
// ignored. Any name the model invented came back as a real call (#236).
//
// This is not hypothetical. Benchmarking SmolLM2-360M (our default) against our own tools with
// our own prompt, "create a task called review the PR" produced:
//
//   ```tool
//   {"tool": "list_notes", "arguments": {"note": "Review the PR"}}
//   ```
//
// `list_notes` does not exist. The parser returned it as a call, on 2 of 6 prompts. A model that
// invents a plausible tool name is the normal case at this size, not an edge case.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolCall, parseNativeToolCall, looksLikeToolCall } from './toolCall.js';

const KNOWN = ['list_tasks', 'create_task'];
const fenced = (json: string): string => '```tool\n' + json + '\n```';

describe('parseToolCall — toolNames is a gate, not a hint (#236)', () => {
  test('a real tool parses', () => {
    const call = parseToolCall(fenced('{"tool": "create_task", "arguments": {"title": "x"}}'), KNOWN);
    assert.deepEqual(call, { tool: 'create_task', arguments: { title: 'x' } });
  });

  test('THE BUG: a hallucinated tool name does NOT parse', () => {
    // The exact reply the model produced. It is well-formed JSON in the exact shape we asked
    // for — and it names a tool that does not exist. Well-formed is not real.
    const call = parseToolCall(fenced('{"tool": "list_notes", "arguments": {"note": "Review the PR"}}'), KNOWN);
    assert.equal(call, null, 'an invented tool name must not come back as a call');
  });

  test('a destructive-sounding invention does not parse either', () => {
    assert.equal(parseToolCall(fenced('{"tool": "delete_everything", "arguments": {}}'), KNOWN), null);
  });

  test('the rejected reply still LOOKS like a tool call, so the model gets corrected', () => {
    // This is why returning null is the right shape rather than throwing or inventing a result:
    // the caller sees "no call" AND "looked like one", tells the model its format was wrong, and
    // falls back to a plain answer after two failures. Silently treating it as prose would print
    // raw JSON at the user.
    const reply = fenced('{"tool": "list_notes", "arguments": {}}');
    assert.equal(parseToolCall(reply, KNOWN), null);
    assert.equal(looksLikeToolCall(reply, KNOWN), true);
  });

  test('an EMPTY allowlist means nothing is callable (it used to mean "anything")', () => {
    assert.equal(parseToolCall(fenced('{"tool": "create_task", "arguments": {}}'), []), null);
    assert.equal(parseToolCall(fenced('{"tool": "create_task", "arguments": {}}')), null, 'and by default');
  });

  test('the other shapes are gated too, not just the fenced one', () => {
    // `{ "<name>": {…} }` shorthand — this path already checked, and must keep checking.
    assert.deepEqual(parseToolCall('{"list_tasks": {}}', KNOWN), { tool: 'list_tasks', arguments: {} });
    assert.equal(parseToolCall('{"list_notes": {}}', KNOWN), null);

    // `name(...)` function syntax — only known names are even scanned for.
    assert.deepEqual(parseToolCall('list_tasks()', KNOWN), { tool: 'list_tasks', arguments: {} });
    assert.equal(parseToolCall('list_notes()', KNOWN), null);

    // Bare JSON, no fence.
    assert.equal(parseToolCall('{"tool": "nope", "arguments": {}}', KNOWN), null);
  });

  test('a real call still parses when the model wraps it in chatter', () => {
    const reply = 'Sure! Here you go:\n```tool\n{"tool": "list_tasks", "arguments": {}}\n```\nAnything else?';
    assert.deepEqual(parseToolCall(reply, KNOWN), { tool: 'list_tasks', arguments: {} });
  });

  test('an invented call followed by a real one does not block the real one', () => {
    // scanJson walks every balanced object; rejecting one must not abandon the scan.
    const reply = '{"tool": "list_notes", "arguments": {}} {"tool": "list_tasks", "arguments": {}}';
    assert.deepEqual(parseToolCall(reply, KNOWN), { tool: 'list_tasks', arguments: {} });
  });
});

describe('parseNativeToolCall — the AUTHORITATIVE path was unguarded too (#236)', () => {
  // This is tried BEFORE the text is scraped, so an unguarded native call bypasses everything.
  // Fixing only the JSON path would have left the more-trusted door open.
  test('a real native call parses', () => {
    const call = parseNativeToolCall([{ function: { name: 'create_task', arguments: '{"title":"x"}' } }], KNOWN);
    assert.deepEqual(call, { tool: 'create_task', arguments: { title: 'x' } });
  });

  test('a hallucinated native call does NOT parse, however well-formed', () => {
    assert.equal(parseNativeToolCall([{ function: { name: 'list_notes', arguments: '{}' } }], KNOWN), null);
  });

  test('an empty allowlist means nothing is callable here either', () => {
    assert.equal(parseNativeToolCall([{ function: { name: 'create_task', arguments: '{}' } }], []), null);
  });

  test('no native call at all is null, not a crash', () => {
    assert.equal(parseNativeToolCall(null, KNOWN), null);
    assert.equal(parseNativeToolCall([], KNOWN), null);
  });
});

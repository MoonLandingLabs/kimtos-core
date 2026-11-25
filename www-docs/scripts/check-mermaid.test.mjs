// Proves check-mermaid.mjs actually catches a broken diagram and passes a valid one, using
// mermaid's real parser -- so the guard cannot rot into a no-op that reports green on anything.
// The invalid diagram lives HERE, in the test, never in shipped docs content (which stays green).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMermaidBlocks, diagramError } from './check-mermaid.mjs';

test('extractMermaidBlocks finds fenced diagrams with their opening line', () => {
  const md = ['# Title', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '', 'after'].join('\n');
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].line, 3);
  assert.equal(blocks[0].code, 'flowchart LR\n  A --> B');
});

test('extractMermaidBlocks ignores an inline ```mermaid mention (README-style)', () => {
  // The apps README writes a literal ` ```mermaid ` inside backticks in prose. It is not a fence.
  const md = 'Most apps include a ` ```mermaid ` diagram of the flow.';
  assert.deepEqual(extractMermaidBlocks(md), []);
});

test('extractMermaidBlocks handles multiple blocks and tilde fences', () => {
  const md = ['```mermaid', 'flowchart LR', 'A-->B', '```', '', '~~~mermaid', 'classDiagram', 'class X', '~~~'].join(
    '\n',
  );
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].line, 6);
});

test('extractMermaidBlocks keeps an unclosed fence so it is still validated', () => {
  const md = ['```mermaid', 'flowchart LR', 'A --> B'].join('\n'); // no closing fence
  const blocks = extractMermaidBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].code, 'flowchart LR\nA --> B');
});

test('diagramError returns null for a valid diagram', async () => {
  assert.equal(await diagramError('flowchart LR\n  A[Start] --> B[End]'), null);
  assert.equal(await diagramError('sequenceDiagram\n  Alice->>Bob: Hi'), null);
});

test('diagramError reports a message for a syntax error', async () => {
  const err = await diagramError('flowchart LR\n  A[Start] -->');
  assert.ok(err, 'a dangling edge must be rejected');
  assert.match(err, /Parse error/i);
});

test('diagramError rejects the exact defect that shipped: an unquoted @ in a node label', async () => {
  // docs/extension/apps/rephrase used `PROMPT[rephrase.md<br/>@kimtos/prompts]`; mermaid 11 reads
  // the @ as a link-id token and the diagram shows a red error box in the reader's browser (#896).
  assert.ok(await diagramError('flowchart LR\n  A --> P[pkg<br/>@scope/name]'));
  // Quoting the label is the fix, and it must parse.
  assert.equal(await diagramError('flowchart LR\n  A --> P["pkg<br/>@scope/name"]'), null);
});

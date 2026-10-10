import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from '../lib/markdown.js';

function types(blocks) {
  return blocks.map((block) => block.type);
}

test('empty content produces no blocks', () => {
  assert.deepEqual(renderMarkdown(''), []);
  assert.deepEqual(renderMarkdown(null), []);
  assert.deepEqual(renderMarkdown('   \n  '), []);
});

test('every block carries a unique key and a className', () => {
  const blocks = renderMarkdown('# Hi\n\nbody');
  assert.equal(blocks.length, 2);
  const keys = blocks.map((block) => block.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const block of blocks) {
    assert.ok(block.className.startsWith('md-block md-'), `unexpected className ${block.className}`);
  }
});

test('headings map to the three heading levels', () => {
  assert.equal(renderMarkdown('# h1')[0].type, 'heading1');
  assert.equal(renderMarkdown('## h2')[0].type, 'heading2');
  assert.equal(renderMarkdown('### h3')[0].type, 'heading3');
  assert.equal(renderMarkdown('###### h6')[0].type, 'heading3');
});

test('inline code is split into a dedicated monospace run without backticks', () => {
  const blocks = renderMarkdown('Use the `page.request` method to fetch.');
  assert.equal(blocks[0].type, 'paragraph');
  const codeRun = blocks[0].runs.find((run) => run.cls.indexOf('md-ic') >= 0);
  assert.ok(codeRun, 'expected an inline-code run');
  assert.equal(codeRun.text, 'page.request');
  assert.equal(blocks[0].text.indexOf('`'), -1);
});

test('inline strong maps to a bold run', () => {
  const blocks = renderMarkdown('This is **bold** text.');
  const boldRun = blocks[0].runs.find((run) => run.cls.indexOf('md-ib') >= 0);
  assert.ok(boldRun);
  assert.equal(boldRun.text, 'bold');
});

test('plain text field is the concatenation of runs', () => {
  const blocks = renderMarkdown('a `b` c');
  assert.equal(blocks[0].text, 'a b c');
});

test('ordered and unordered lists flatten with prefixes and nesting depth', () => {
  const blocks = renderMarkdown('1. one\n2. two\n\n- a\n  - nested\n');
  assert.deepEqual(types(blocks), ['list_item', 'list_item', 'list_item', 'list_item']);
  assert.equal(blocks[0].text, '1. one');
  assert.equal(blocks[1].text, '2. two');
  assert.equal(blocks[2].text, '· a');
  assert.equal(blocks[3].text, '· nested');
});

test('task list items render checkbox state', () => {
  const blocks = renderMarkdown('- [x] done\n- [ ] todo\n');
  assert.equal(blocks[0].text, '· [x] done');
  assert.equal(blocks[1].text, '· [ ] todo');
});

test('code blocks keep their text and a code className with no runs', () => {
  const blocks = renderMarkdown('```js\nconst x = 1;\nconst y = 2;\n```\n');
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].text, 'const x = 1;\nconst y = 2;');
  assert.equal(blocks[0].lang, 'js');
  assert.ok(blocks[0].className.indexOf('md-code') >= 0);
  assert.ok(!blocks[0].runs || blocks[0].runs.length === 0);
});

test('blockquotes become quote blocks', () => {
  const blocks = renderMarkdown('> stay on target\n');
  assert.equal(blocks[0].type, 'quote');
  assert.equal(blocks[0].text, 'stay on target');
});

test('tables flatten into row blocks with the header marked', () => {
  const blocks = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |\n');
  assert.deepEqual(types(blocks), ['table_row', 'table_row']);
  assert.equal(blocks[0].text, 'A  B');
  assert.ok(blocks[0].className.indexOf('md-table_head') >= 0);
  assert.equal(blocks[1].text, '1  2');
});

test('hr renders a dedicated block with a dash line', () => {
  const blocks = renderMarkdown('a\n\n---\n\nb\n');
  assert.deepEqual(types(blocks), ['paragraph', 'hr', 'paragraph']);
  assert.ok(blocks[1].text.length > 0);
});

test('streaming partial markdown is healed into renderable blocks', () => {
  const partial = renderMarkdown('## Unfinished *head\n\n- one\n- two\n\n```py\ndef f(');
  assert.deepEqual(types(partial), ['heading2', 'list_item', 'list_item', 'code']);
  assert.equal(partial[0].text, 'Unfinished *head');
  assert.ok(partial[3].text.startsWith('def f('));
});

test('malformed input never throws and falls back to a paragraph', () => {
  const blocks = renderMarkdown(String.raw`[unclosed( \`\`\` broken`);
  assert.ok(blocks.length >= 1);
  assert.equal(blocks[0].type, 'paragraph');
});

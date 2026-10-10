// Markdown pipeline for chat bodies: the vendored marked lexer (see
// lib/vendor/) tokenizes a message, remend heals truncated streaming
// markdown, and the helpers below flatten both into renderable WXML blocks.
import { marked } from './vendor/marked.min.js';
import heal from './vendor/remend.min.js';

function pushInline(tokens, runs, cls) {
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
        if (token.tokens && token.tokens.length) pushInline(token.tokens, runs, cls);
        else if (token.text) runs.push({ text: token.text, cls });
        break;
      case 'strong':
      case 'em':
        pushInline(token.tokens || [], runs, `${cls} md-ib`);
        break;
      case 'del':
        pushInline(token.tokens || [], runs, cls);
        break;
      case 'codespan':
        if (token.text) runs.push({ text: token.text, cls: `${cls} md-ic` });
        break;
      case 'link':
        pushInline(token.tokens && token.tokens.length ? token.tokens : [{ type: 'text', text: token.text || '' }], runs, cls);
        break;
      case 'image':
        runs.push({ text: token.text || 'image', cls });
        break;
      case 'br':
        break;
      default:
        if (token.text) runs.push({ text: token.text, cls });
    }
  }
}

function inlineRuns(tokens, cls) {
  const runs = [];
  pushInline(tokens || [], runs, cls);
  return runs;
}

function runsToText(runs) {
  return runs.map((run) => run.text).join('');
}

function headingType(depth) {
  if (depth <= 1) return 'heading1';
  if (depth === 2) return 'heading2';
  return 'heading3';
}

function indentClass(depth) {
  return depth > 0 ? ` md-indent-${Math.min(depth, 3)}` : '';
}

function blockFromRuns(type, runs, className, leadPrefix) {
  if (!runs.length) return null;
  if (leadPrefix) runs[0] = { text: leadPrefix + runs[0].text, cls: runs[0].cls };
  return { type, text: runsToText(runs), className, runs };
}

function flattenList(listToken, depth, out) {
  const ordered = Boolean(listToken.ordered);
  const start = Number(listToken.start) || 1;
  const items = listToken.items || [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const subLists = [];
    let inlineTokens = [];
    for (const child of item.tokens || []) {
      if (child.type === 'list') {
        subLists.push(child);
      } else if (child.type === 'space') {
        continue;
      } else if (child.type === 'text') {
        inlineTokens = inlineTokens.concat(child.tokens && child.tokens.length ? child.tokens : [{ type: 'text', text: child.text || '' }]);
      } else if (child.tokens) {
        inlineTokens = inlineTokens.concat(child.tokens);
      } else if (child.text) {
        inlineTokens.push({ type: 'text', text: child.text });
      }
    }
    const checkbox = item.task ? (item.checked ? '[x] ' : '[ ] ') : '';
    const bullet = ordered ? `${start + i}. ` : '· ';
    const runs = inlineRuns(inlineTokens, 'md-list').map((run) => ({ ...run, text: run.text.replace(/\s*\n\s*/g, ' ') }));
    const block = blockFromRuns('list_item', runs, `md-block md-list_item${indentClass(depth)}`, `${bullet}${checkbox}`);
    if (block) out.push(block);
    for (const sub of subLists) flattenList(sub, depth + 1, out);
  }
}

function flattenTokens(tokens, out) {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const type = headingType(token.depth);
        const runs = inlineRuns(token.tokens || [{ type: 'text', text: token.text || '' }], `md-${type}`);
        const block = blockFromRuns(type, runs, `md-block md-${type}`);
        if (block) out.push(block);
        break;
      }
      case 'paragraph': {
        const runs = inlineRuns(token.tokens || [{ type: 'text', text: token.text || '' }], 'md-paragraph');
        const block = blockFromRuns('paragraph', runs, 'md-block md-paragraph');
        if (block) out.push(block);
        break;
      }
      case 'code':
        out.push({ type: 'code', text: String(token.text || ''), lang: token.lang || '', className: 'md-block md-code' });
        break;
      case 'blockquote': {
        const inner = [];
        for (const child of token.tokens || []) {
          if (child.type === 'paragraph') inner.push(...(child.tokens || [{ type: 'text', text: child.text || '' }]));
          else if (child.text) inner.push({ type: 'text', text: child.text });
        }
        const runs = inlineRuns(inner, 'md-quote');
        const block = blockFromRuns('quote', runs, 'md-block md-quote');
        if (block) out.push(block);
        break;
      }
      case 'list':
        flattenList(token, 0, out);
        break;
      case 'hr':
        out.push({ type: 'hr', text: '————————————', className: 'md-block md-hr' });
        break;
      case 'table': {
        const join = (cells) => cells.map((cell) => runsToText(inlineRuns(cell.tokens || [{ type: 'text', text: cell.text }], 'md-t')).trim()).join('  ');
        out.push({ type: 'table_row', text: join(token.header || []), className: 'md-block md-table_row md-table_head', runs: [] });
        for (const row of token.rows || []) {
          out.push({ type: 'table_row', text: join(row), className: 'md-block md-table_row', runs: [] });
        }
        break;
      }
      case 'space':
      case 'html':
        break;
      default:
        if (token.text) out.push({ type: 'paragraph', text: String(token.text), className: 'md-block md-paragraph', runs: [{ text: String(token.text), cls: 'md-paragraph' }] });
    }
  }
}

export function renderMarkdown(content) {
  const raw = String(content || '');
  if (!raw.trim()) return [];
  let tokens;
  try {
    tokens = marked.lexer(heal(raw));
  } catch (error) {
    return [{ type: 'paragraph', text: raw, className: 'md-block md-paragraph', runs: [{ text: raw, cls: 'md-paragraph' }] }];
  }
  const out = [];
  flattenTokens(tokens, out);
  while (out.length && !out[out.length - 1].text && out[out.length - 1].type !== 'hr') out.pop();
  let keyIndex = 0;
  return out.map((block) => ({ ...block, key: `md-${keyIndex++}` }));
}

#!/usr/bin/env node
// Snapshot-sync the internal repo to the public GitHub mirror.
//
// The public repo must never receive the internal Git history (it contains
// real credentials), so sync = rsync the working tree into a clean clone +
// one neutral-author commit + push. Safety rails: refuses to run on a dirty
// working tree (unless --force) and aborts on credential/doc-domain leaks.
//
// Manual run:  node scripts/sync-public.mjs [-m "message"] [--force]
// Wired to fire automatically from .git/hooks/pre-push (origin pushes only).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_URL = 'https://github.com/prism-rokid/prism-aiui.git';
const PUBLIC_DIR = process.env.PRISM_PUBLIC_DIR || '/tmp/prism-aiui-public';
const AUTHOR = { name: 'Eis4TY', email: '41855716+Eis4TY@users.noreply.github.com' };
const RSYNC_EXCLUDES = ['.git', 'env.json', 'node_modules', '.aix', '.zcode', '.agents', '.mastergo', '.DS_Store'];

function run(command, args, { cwd, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    let out = '';
    if (capture) child.stdout.on('data', (data) => { out += data; });
    child.once('error', reject);
    child.once('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${command} ${args.join(' ')} failed (exit ${code})`))));
  });
}

async function existsDir(dir) {
  try { await fs.access(path.join(dir, '.git')); return true; } catch { return false; }
}

async function ensureClone() {
  if (await existsDir(PUBLIC_DIR)) {
    // Older clones carry a different origin (e.g. the internal repo path);
    // the public URL must be origin for fetch/push below.
    const url = (await run('git', ['remote', 'get-url', 'origin'], { cwd: PUBLIC_DIR, capture: true })).trim();
    if (url !== PUBLIC_URL) {
      console.log(`[sync-public] normalizing clone origin: ${url} -> ${PUBLIC_URL}`);
      await run('git', ['remote', 'set-url', 'origin', PUBLIC_URL], { cwd: PUBLIC_DIR });
    }
    return;
  }
  console.log(`[sync-public] cloning the public mirror to ${PUBLIC_DIR} ...`);
  await run('git', ['clone', PUBLIC_URL, PUBLIC_DIR]);
}

// Leak gates: real JWT bodies anywhere, relay hostnames in docs.
async function leakScan() {
  const problems = [];
  const grep = async (pattern, files, label) => {
    try {
      const out = await run('grep', ['-rl', ...files, '--exclude-dir=.git', '--exclude-dir=node_modules', pattern], { cwd: PUBLIC_DIR, capture: true });
      if (out.trim()) problems.push(`${label}: ${out.trim().split('\n').join(', ')}`);
    } catch { /* grep exit 1 = no matches */ }
  };
  await grep('eyJ0eXAi', ['.'], 'real JWT found in snapshot');
  await grep('ai-cloud', ['README.md', 'CONTRIBUTING.md'], 'relay hostnames leaked into docs');
  return problems;
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const messageIndex = args.indexOf('-m');
  const explicitMessage = messageIndex >= 0 && args[messageIndex + 1] ? args[messageIndex + 1] : '';

  const dirty = await run('git', ['status', '--porcelain'], { cwd: ROOT, capture: true });
  if (dirty.trim() && !force) {
    throw new Error(`internal working tree is dirty:\n${dirty.trim()}\nCommit first, or re-run with --force to publish the working tree as-is.`);
  }

  await ensureClone();
  const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: PUBLIC_DIR, capture: true })).trim();
  if (branch !== 'main') await run('git', ['checkout', '-q', 'main'], { cwd: PUBLIC_DIR });
  await run('git', ['fetch', '-q', 'origin', 'main'], { cwd: PUBLIC_DIR });
  const localHead = (await run('git', ['rev-parse', 'HEAD'], { cwd: PUBLIC_DIR, capture: true })).trim();
  const remoteHead = (await run('git', ['rev-parse', 'origin/main'], { cwd: PUBLIC_DIR, capture: true })).trim();
  if (localHead !== remoteHead) {
    throw new Error('public clone diverged from origin/main — inspect manually before syncing.');
  }

  await run('rsync', ['-a', '--delete', ...RSYNC_EXCLUDES.flatMap((name) => ['--exclude', name]), `${ROOT}/`, `${PUBLIC_DIR}/`]);
  const changes = (await run('git', ['status', '--porcelain'], { cwd: PUBLIC_DIR, capture: true })).trim();
  if (!changes) {
    console.log('[sync-public] already in sync.');
    return;
  }

  const problems = await leakScan();
  if (problems.length) throw new Error(`refusing to publish:\n  ${problems.join('\n  ')}`);

  const message = explicitMessage
    || (await run('git', ['log', '-1', '--pretty=%B'], { cwd: ROOT, capture: true })).trim()
    || 'Sync internal master';
  await run('git', ['add', '-A'], { cwd: PUBLIC_DIR });
  await run('git', ['-c', `user.name=${AUTHOR.name}`, '-c', `user.email=${AUTHOR.email}`, 'commit', '-q', '-m', message], { cwd: PUBLIC_DIR });
  await run('git', ['push', 'origin', 'main'], { cwd: PUBLIC_DIR });
  console.log('[sync-public] published to github.com/prism-rokid/prism-aiui (main).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[sync-public] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}

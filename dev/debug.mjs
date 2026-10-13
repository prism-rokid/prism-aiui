#!/usr/bin/env node
// One-command real-device debug: reads the account token from the Prism
// Hub config (~/.prism/config.yaml), injects it into lib/prism-local-token.js,
// packs (restoring the file immediately afterwards), enables developer mode,
// installs the package on the connected glasses via the aix CLI and opens
// the panel page. `npm run debug` is all a contributor runs.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_TOKEN_PATH = path.join(ROOT, 'lib', 'prism-local-token.js');
// This repo ships against production only; test relays stay an internal
// alias that docs never mention.
const DEFAULT_TARGET = 'production';

// Aliases keep relay hostnames out of the docs: `--target production`
// resolves here instead of being spelled out in README/CONTRIBUTING.
const TARGET_ALIASES = {
  test: 'https://ai-cloud-test.rokid.com',
  prod: 'https://ai-cloud.rokid.com',
  production: 'https://ai-cloud.rokid.com'
};

export function normalizeTarget(target) {
  const value = String(target || '').trim().replace(/\/+$/, '');
  const aliased = TARGET_ALIASES[value.toLowerCase()] || value;
  return aliased.replace(/\/+$/, '');
}

// Exact mirror of the checked-in lib/prism-local-token.js. Written back
// after packing (and on any failure), so a crashed run never leaves a
// token in the working tree. tests/debug-auth.test.mjs keeps both copies
// in sync.
export const LOCAL_TOKEN_TEMPLATE = `// Local debug credential slot — DO NOT put a real token here.
//
// This module is bundled into every package, so it is the one channel a
// real-device debug build can rely on: the Ink runtime has no way to load
// external overrides on the glasses. \`npm run debug\` (dev/debug.mjs)
// temporarily writes the relay target and your Prism account token here,
// packs, and immediately restores the empty values below — the checked-in
// file never contains a credential (tests enforce this).
export const LOCAL_DEBUG_AUTH = Object.freeze({
  // Example of what \`npm run debug\` writes before packing (never commit):
  //   baseUrl: 'https://ai-cloud-test.rokid.com/prism/api',
  //   accountToken: '<access_token from ~/.prism/config.yaml>'
  baseUrl: '',
  accountToken: ''
});
`;

function yamlScalar(value) {
  let out = String(value).trim();
  if (out.startsWith('#')) return '';
  out = out.replace(/\s+#.*$/, '').trim();
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

function mapKey(content) {
  const match = content.match(/^(?:"([^"]+)"|'([^']+)'|([^:#\s][^:]*)):\s*(.*)$/);
  if (!match) return null;
  return { key: (match[1] ?? match[2] ?? match[3]).trim(), value: yamlScalar(match[4]) };
}

/**
 * Extract `{ "<env>.<region>": { name, accessToken } }` from the Prism Hub
 * config.yaml. The file is written by Prism Hub itself, so a small
 * indentation-aware scanner is enough; anything unexpected yields fewer
 * identities rather than a crash, and the caller reports the miss.
 */
export function parsePrismIdentities(text) {
  const identities = {};
  let identitiesIndent = -1;
  let currentKey = null;
  let currentIndent = -1;
  let inPrism = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\t/g, '  ');
    const content = line.trim();
    if (!content || content.startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    if (identitiesIndent < 0) {
      if (inPrism) {
        if (content === 'identities:' && indent > 0) {
          identitiesIndent = indent;
          continue;
        }
        if (indent === 0) inPrism = false;
      } else if (indent === 0 && content === 'prism:') {
        inPrism = true;
      }
      continue;
    }
    if (indent <= identitiesIndent) break;
    const entry = mapKey(content);
    if (!entry) continue;
    if (!entry.value && indent > identitiesIndent && indent <= identitiesIndent + 4) {
      currentKey = entry.key;
      currentIndent = indent;
      identities[currentKey] = { name: '', accessToken: '' };
      continue;
    }
    if (currentKey !== null && indent > currentIndent) {
      if (entry.key === 'access_token' && entry.value) identities[currentKey].accessToken = entry.value;
      if (entry.key === 'name' && entry.value) identities[currentKey].name = entry.value;
    }
  }
  return identities;
}

/**
 * Choose the identity that matches the relay target: the test gateway pairs
 * with the test login, anything else with production. A config holding only
 * one usable identity (dev builds, custom targets) falls back to it.
 */
export function pickPreviewIdentity(identities, target) {
  let hostname = '';
  try { hostname = new URL(target).hostname; } catch { hostname = String(target || ''); }
  const preferred = hostname.includes('test') ? 'test.cn' : 'prod.cn';
  if (identities[preferred] && identities[preferred].accessToken) {
    return { key: preferred, ...identities[preferred] };
  }
  const fallback = Object.keys(identities).find((key) => identities[key].accessToken);
  if (!fallback) return null;
  return { key: fallback, ...identities[fallback] };
}

function parseArgs(argv) {
  const options = { target: process.env.PROXY_TARGET || DEFAULT_TARGET, serial: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--target' || arg === '-s' || arg === '--serial') && argv[i + 1]) {
      if (arg === '--target') options.target = argv[++i];
      else options.serial = argv[++i];
    }
  }
  options.target = normalizeTarget(options.target);
  return options;
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: ROOT, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    let out = '';
    if (capture) child.stdout.on('data', (data) => { out += data; });
    child.once('error', reject);
    child.once('close', (code) => (code === 0
      ? resolve(out)
      : reject(new Error(`${command} ${args.join(' ')} failed (exit ${code})`))));
  });
}

// `aix` is usually on PATH; some npm setups only expose it as
// ~/.local/bin/aix, which a bare spawn() cannot see. `--help` is the probe:
// older CLIs do not implement `--version` and exit non-zero on it.
async function resolveAix() {
  const candidates = ['aix', path.join(os.homedir(), '.local', 'bin', 'aix')];
  for (const candidate of candidates) {
    try {
      await run(candidate, ['--help'], { capture: true });
      return candidate;
    } catch { /* try the next candidate */ }
  }
  throw new Error('aix CLI not found. Install it once with:\n  npm install -g @yodaos-pkg/aix-cli');
}

async function readDebugToken(options) {
  const configPath = process.env.PRISM_CONFIG
    ? path.resolve(process.env.PRISM_CONFIG)
    : path.join(os.homedir(), '.prism', 'config.yaml');
  try {
    return {
      configPath,
      identity: pickPreviewIdentity(parsePrismIdentities(await fs.readFile(configPath, 'utf8')), options.target)
    };
  } catch {
    return { configPath, identity: null };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = options.target;
  const serialArgs = options.serial ? ['--serial', options.serial] : [];

  let aix;
  try {
    aix = await resolveAix();
  } catch (error) {
    console.error(`[debug] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const { configPath, identity } = await readDebugToken(options);
  if (!identity) {
    console.warn(`[debug] No Prism account token in ${configPath} — installing without sign-in (the panel shows its connect guide). Sign in to Prism Hub once and re-run for live data.`);
  } else {
    console.log(`[debug] Sign-in: identity ${identity.key}, account ${identity.name || 'unknown'}, token length ${identity.accessToken.length}`);
  }

  const injected = `// TEMPORARY debug injection by \`npm run debug\` — restored right after packing.
export const LOCAL_DEBUG_AUTH = Object.freeze({
  baseUrl: ${JSON.stringify(`${target}/prism/api`)},
  accountToken: ${JSON.stringify(identity ? identity.accessToken : '')}
});
`;
  await fs.writeFile(LOCAL_TOKEN_PATH, injected, 'utf8');
  let packResult = null;
  try {
    console.log(`[debug] Packing debug package (relay: ${target}) ...`);
    const stdout = await run('node', ['scripts/pack-project.mjs'], { capture: true });
    const line = stdout.split(/\r?\n/).reverse().find((candidate) => candidate.trimStart().startsWith('{'));
    packResult = line ? JSON.parse(line) : null;
  } finally {
    await fs.writeFile(LOCAL_TOKEN_PATH, LOCAL_TOKEN_TEMPLATE, 'utf8');
  }
  if (!packResult || packResult.status !== 'success') {
    throw new Error('pack did not report success');
  }
  const packagePath = packResult.output;
  console.log(`[debug] Package ready: ${packagePath}`);

  console.log('[debug] Enabling developer mode ...');
  await run(aix, [...serialArgs, 'device', 'set-dev']);

  const definition = path.join(path.dirname(packagePath), 'definition.json');
  const installArgs = [...serialArgs, 'install', packagePath];
  if (await fs.access(definition).then(() => true, () => false)) installArgs.push('--definition', definition);
  console.log('[debug] Installing to device ...');
  await run(aix, installArgs);

  console.log('[debug] Opening the panel page ...');
  await run(aix, [...serialArgs, 'launch-page', packagePath, 'pages/index/index']);
  console.log('[debug] Done. Logs: adb logcat -s Ink');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[debug] ${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}

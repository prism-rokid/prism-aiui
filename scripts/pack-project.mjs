#!/usr/bin/env node
// Pack wrapper: shells out to the official @yodaos-pkg/aix-cli to build
// package.aix (with listing + sha256 checks). Kept in scripts/ so
// `npm run pack` works on any checkout without a global CLI install.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PACKAGE = '@yodaos-pkg/aix-cli';
const PINNED_VERSION = '0.8.2';
const controller = new AbortController();
const { signal } = controller;
let stage = 'input';

function parseOptions(args) {
  const options = { project: process.cwd(), optimize: false, optLevel: 2 };
  const names = { '--project': 'project', '--output': 'output', '--aix-bin': 'aixBin', '--engine': 'engine', '--opt-level': 'optLevel' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    if (arg === '--optimize') { options.optimize = true; continue; }
    if (!names[arg] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${arg}. Use --help.`);
    options[names[arg]] = args[++i];
  }
  options.optLevel = Number(options.optLevel);
  if (![1, 2, 3].includes(options.optLevel)) throw new Error('--opt-level must be 1, 2 or 3.');
  if (options.engine !== undefined && !options.engine.trim()) throw new Error('--engine must not be empty.');
  return options;
}
function within(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function exists(file) {
  try { await fs.access(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
// Resolve symlinked ancestors even when the output directory does not exist yet.
async function canonicalOutput(file) {
  try { return await fs.realpath(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    if (parent === file) throw error;
    return path.join(await canonicalOutput(parent), path.basename(file));
  }
}
async function preparePaths(options) {
  const project = await fs.realpath(path.resolve(options.project));
  const app = JSON.parse(await fs.readFile(path.join(project, 'app.json'), 'utf8'));
  if (!app || typeof app !== 'object' || Array.isArray(app)) throw new Error('app.json must contain an object.');
  const requested = path.resolve(options.output || path.join(path.dirname(project), '.aiui-build', path.basename(project), 'package.aix'));
  if (path.extname(requested).toLowerCase() !== '.aix') throw new Error('--output must name an .aix file.');
  try {
    const stat = await fs.lstat(requested);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Existing output must be a regular file, not a directory or symlink.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const output = await canonicalOutput(requested);
  if (within(project, output)) throw new Error('Output must be outside the input project to avoid repackaging previous artifacts.');
  return { project, output };
}
function run(command, args, { cwd, capture = false, timeout = 0 } = {}) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    const output = [];
    let failure;
    let forceTimer;
    function stop(error) {
      if (failure) return;
      failure = error;
      child.kill('SIGTERM');
      forceTimer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      forceTimer.unref();
    }
    const aborted = () => stop(signal.reason || new Error('Interrupted.'));
    signal.addEventListener('abort', aborted, { once: true });
    const deadline = timeout ? setTimeout(() => stop(new Error(`${path.basename(command)} timed out after ${timeout}ms.`)), timeout) : undefined;
    deadline?.unref();
    child.stdout.on('data', data => {
      process.stderr.write(data);
      if (capture) output.push(data);
    });
    child.stderr.on('data', data => process.stderr.write(data));
    child.once('error', error => { failure = error; });
    // Cleanup callers must not run until the child can no longer write artifacts.
    child.once('close', (code, termination) => {
      clearTimeout(deadline);
      clearTimeout(forceTimer);
      signal.removeEventListener('abort', aborted);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${path.basename(command)} failed (${termination || `exit ${code}`}).`));
      else resolve(Buffer.concat(output).toString('utf8'));
    });
  });
}
async function npmTool(packageFile, source, expectedVersion) {
  const pkg = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.aix;
  if (pkg.name !== PACKAGE || typeof bin !== 'string' || !bin || typeof pkg.version !== 'string') throw new Error(`Invalid official CLI package at ${packageFile}.`);
  if (expectedVersion && pkg.version !== expectedVersion) throw new Error(`Expected ${PACKAGE}@${expectedVersion}, found ${pkg.version}.`);
  const packageDir = await fs.realpath(path.dirname(packageFile));
  const executable = await fs.realpath(path.resolve(packageDir, bin));
  if (!within(packageDir, executable) || !(await fs.stat(executable)).isFile()) throw new Error('Official CLI entry must be a file inside its package.');
  return { command: process.execPath, prefix: [executable], source, path: executable, version: pkg.version };
}
function defaultCacheRoot() {
  if (process.env.AIUI_PACK_CACHE_DIR) return path.resolve(process.env.AIUI_PACK_CACHE_DIR);
  const cache = process.env.XDG_CACHE_HOME || (process.platform === 'win32'
    ? process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local')
    : process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Caches') : path.join(os.homedir(), '.cache'));
  return path.resolve(cache, 'aiui-dev');
}
function npmCommand() {
  if (process.env.npm_execpath) return [process.execPath, [process.env.npm_execpath]];
  if (process.platform === 'win32') return [process.execPath, [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]];
  return ['npm', []];
}
async function cachedTool(project) {
  const root = await canonicalOutput(defaultCacheRoot());
  if (within(project, root)) throw new Error('AIUI_PACK_CACHE_DIR must be outside the input project.');
  const directory = path.join(root, `aix-cli-${PINNED_VERSION}`);
  const packageRelative = 'node_modules/@yodaos-pkg/aix-cli/package.json';
  const packageFile = path.join(directory, packageRelative);
  const lock = `${directory}.lock`;
  async function ready() {
    if (!await exists(packageFile)) return null;
    return npmTool(packageFile, 'cache', PINNED_VERSION);
  }
  const initial = await ready();
  if (initial) return initial;
  await fs.mkdir(root, { recursive: true });
  const deadline = Date.now() + 120_000;
  while (true) {
    signal.throwIfAborted();
    const cached = await ready();
    if (cached) return cached;
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for CLI preparation lock: ${lock}. Check the owning process before removing a stale lock.`);
      await delay(200, undefined, { signal });
    }
  }
  let temporary;
  try {
    await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    const cached = await ready();
    if (cached) return cached;
    temporary = await fs.mkdtemp(path.join(root, '.aix-install-'));
    console.error(`[pack] Preparing ${PACKAGE}@${PINNED_VERSION} in the user cache.`);
    const [command, prefix] = npmCommand();
    await run(command, [...prefix, 'install', '--prefix', temporary, '--no-audit', '--no-fund', '--ignore-scripts', `${PACKAGE}@${PINNED_VERSION}`], { cwd: temporary, timeout: 120_000 });
    await npmTool(path.join(temporary, packageRelative), 'cache', PINNED_VERSION);
    await fs.rename(temporary, directory);
    temporary = undefined;
    return npmTool(packageFile, 'cache', PINNED_VERSION);
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    await fs.rm(lock, { recursive: true, force: true });
  }
}
async function selectTool(project, options) {
  if (options.aixBin) {
    const executable = await fs.realpath(path.resolve(options.aixBin));
    if (!(await fs.stat(executable)).isFile()) throw new Error('--aix-bin must be an executable file.');
    return { command: executable, prefix: [], source: 'explicit', path: executable, version: null };
  }
  const require = createRequire(path.join(project, 'package.json'));
  let packageFile;
  try { packageFile = require.resolve(`${PACKAGE}/package.json`); }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  if (packageFile) return npmTool(packageFile, 'project');
  return cachedTool(project);
}
async function pack(options) {
  const { project, output } = await preparePaths(options);
  stage = 'tool';
  const tool = await selectTool(project, options);
  signal.throwIfAborted();
  stage = 'output';
  await fs.mkdir(path.dirname(output), { recursive: true });
  const build = randomUUID();
  const temporary = path.join(path.dirname(output), `.tmp-${build}.aix`);
  // Each package result refers to its own immutable listing, including concurrent runs.
  const listing = path.join(path.dirname(output), `${path.basename(output, path.extname(output))}-${build}.contents.txt`);
  let published = false;
  try {
    stage = 'pack';
    const args = ['pack', project, '-o', temporary];
    if (options.engine !== undefined) args.push('--engine', options.engine);
    if (options.optimize) args.push('--optimize', '--opt-level', String(options.optLevel));
    console.error(`[pack] Using ${tool.source} CLI: ${tool.path}`);
    await run(tool.command, [...tool.prefix, ...args], { cwd: project });
    const stat = await fs.lstat(temporary);
    if (!stat.isFile() || stat.size === 0) throw new Error('CLI did not create a non-empty regular AIX file.');
    stage = 'list';
    const contents = await run(tool.command, [...tool.prefix, 'list', temporary], { cwd: project, capture: true });
    if (!contents.trim()) throw new Error('CLI returned an empty package listing.');
    const bytes = await fs.readFile(temporary);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(listing, contents, { flag: 'wx' });
    stage = 'publish';
    signal.throwIfAborted();
    await fs.rename(temporary, output);
    published = true;
    console.log(JSON.stringify({
      status: 'success', output, bytes: bytes.length, sha256,
      tool: { source: tool.source, path: tool.path, version: tool.version },
      listing, checks: { packageCreated: true, archiveReadable: true, runtimeValidated: false },
    }));
  } finally {
    await fs.rm(temporary, { force: true });
    if (!published) await fs.rm(listing, { force: true });
  }
}

process.once('SIGINT', () => controller.abort(new Error('Interrupted.')));
process.once('SIGTERM', () => controller.abort(new Error('Terminated.')));
try {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) console.log('Usage: npm run pack -- [--project DIR] [--output FILE.aix] [--aix-bin EXECUTABLE] [--engine RANGE] [--optimize] [--opt-level 1|2|3]\nDefault output: ../.aiui-build/<project-name>/package.aix\nTool fallback: official @yodaos-pkg/aix-cli@0.8.2 in the user cache (AIUI_PACK_CACHE_DIR overrides its root).');
  else await pack(options);
} catch (error) {
  console.error(`[pack:${stage}] ${error.message}`);
  process.exitCode = 1;
}

#!/usr/bin/env node
/**
 * infrasnap — Snapshots and diffs infrastructure configuration files over time
 * Usage: node src/infrasnap.js <command> [options]
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const STORE      = '.infrasnap-store.json';
const BOLD       = '\x1b[1m';
const GREEN      = '\x1b[32m';
const YELLOW     = '\x1b[33m';
const RED        = '\x1b[31m';
const CYAN       = '\x1b[36m';
const DIM        = '\x1b[2m';
const NC         = '\x1b[0m';

// ── Supported config file patterns ────────────────────────────────────────────
const CONFIG_PATTERNS = [
  /\.ya?ml$/i, /\.json$/i, /\.toml$/i, /\.ini$/i, /\.conf$/i,
  /\.cfg$/i,   /\.env$/i,  /\.tf$/i,   /\.hcl$/i, /Dockerfile$/i,
  /docker-compose\.yml$/i, /\.properties$/i, /nginx\.conf$/i,
  /\.xml$/i,   /\.sh$/i,
];

const SKIP_DIRS  = new Set(['.git','node_modules','.next','dist','build','coverage','.terraform']);
const SKIP_FILES = new Set(['.infrasnap-store.json','package-lock.json','yarn.lock']);

function isConfigFile(filePath) {
  const base = path.basename(filePath);
  if (SKIP_FILES.has(base)) return false;
  return CONFIG_PATTERNS.some(re => re.test(base));
}

// ── Store helpers ─────────────────────────────────────────────────────────────
function loadStore() {
  if (!fs.existsSync(STORE)) return { snapshots: [], environments: {} };
  try { return JSON.parse(fs.readFileSync(STORE, 'utf8')); }
  catch { return { snapshots: [], environments: {} }; }
}

function saveStore(s) { fs.writeFileSync(STORE, JSON.stringify(s, null, 2)); }

// ── File scanning ─────────────────────────────────────────────────────────────
function* walkDir(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkDir(full);
    else if (e.isFile() && isConfigFile(full)) yield full;
  }
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function buildFileMap(targetPath) {
  const map = {};
  const stat = fs.statSync(targetPath);

  const files = stat.isFile()
    ? (isConfigFile(targetPath) ? [targetPath] : [])
    : [...walkDir(targetPath)];

  for (const f of files) {
    try {
      const content = fs.readFileSync(f, 'utf8');
      map[f] = {
        hash:  hashContent(content),
        size:  fs.statSync(f).size,
        lines: content.split('\n').length,
        content,
      };
    } catch { /* skip unreadable */ }
  }
  return map;
}

// ── Commands ──────────────────────────────────────────────────────────────────
function snapshotCommand(targetPath, opts = {}) {
  const resolved = path.resolve(targetPath || '.');
  if (!fs.existsSync(resolved)) { console.error(`❌ Path not found: ${resolved}`); process.exit(1); }

  const env   = opts.env || 'default';
  const label = opts.label || new Date().toISOString().slice(0, 19).replace('T', ' ');

  console.log(`\n${BOLD}${CYAN}📸 infrasnap — Taking Snapshot${NC}`);
  console.log(`Path: ${resolved} | Env: ${env} | Label: ${label}\n`);

  const fileMap = buildFileMap(resolved);
  const fileCount = Object.keys(fileMap).length;

  if (fileCount === 0) {
    console.log(`${YELLOW}⚠️  No config files found in ${resolved}${NC}`);
    return;
  }

  const snapshot = {
    id:        crypto.randomBytes(4).toString('hex'),
    timestamp: new Date().toISOString(),
    label,
    env,
    path:      resolved,
    fileCount,
    files: Object.fromEntries(
      Object.entries(fileMap).map(([f, v]) => [f, { hash: v.hash, size: v.size, lines: v.lines }])
    ),
  };

  const store = loadStore();
  if (!store.environments[env]) store.environments[env] = [];
  store.environments[env].push(snapshot);
  store.snapshots.push({ id: snapshot.id, timestamp: snapshot.timestamp, env, label, fileCount });
  saveStore(store);

  console.log(`${GREEN}✅ Snapshot saved [${snapshot.id}]${NC}`);
  console.log(`   Files captured: ${fileCount}`);
  Object.keys(fileMap).slice(0, 10).forEach(f => console.log(`   ${DIM}• ${path.relative(resolved, f) || path.basename(f)}${NC}`));
  if (fileCount > 10) console.log(`   ${DIM}... and ${fileCount - 10} more${NC}`);
}

function diffCommand(targetPath, opts = {}) {
  const resolved = path.resolve(targetPath || '.');
  const env = opts.env || 'default';

  const store = loadStore();
  const envSnaps = store.environments[env];

  if (!envSnaps || envSnaps.length === 0) {
    console.log(`${YELLOW}⚠️  No snapshots for env "${env}". Run: snapshot [path] --env ${env}${NC}`);
    return;
  }

  const prev = envSnaps[envSnaps.length - 1];
  const curr = buildFileMap(resolved);

  console.log(`\n${BOLD}${CYAN}🔍 infrasnap — Diff Report${NC}`);
  console.log(`Env: ${env} | vs snapshot [${prev.id}] from ${prev.timestamp.slice(0, 19)}\n`);

  const prevFiles = new Set(Object.keys(prev.files));
  const currFiles = new Set(Object.keys(curr));

  const added   = [...currFiles].filter(f => !prevFiles.has(f));
  const removed = [...prevFiles].filter(f => !currFiles.has(f));
  const changed = [...currFiles].filter(f => prevFiles.has(f) && curr[f].hash !== prev.files[f].hash);
  const same    = [...currFiles].filter(f => prevFiles.has(f) && curr[f].hash === prev.files[f].hash);

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log(`${GREEN}✅ No changes detected. Infrastructure config is stable.${NC}`);
    console.log(`   ${same.length} file(s) unchanged.`);
    return;
  }

  if (added.length > 0) {
    console.log(`${GREEN}${BOLD}➕ Added (${added.length})${NC}`);
    added.forEach(f => console.log(`   ${f}`));
    console.log('');
  }

  if (removed.length > 0) {
    console.log(`${RED}${BOLD}➖ Removed (${removed.length})${NC}`);
    removed.forEach(f => console.log(`   ${f}`));
    console.log('');
  }

  if (changed.length > 0) {
    console.log(`${YELLOW}${BOLD}✏️  Changed (${changed.length})${NC}`);
    for (const f of changed) {
      const p = prev.files[f], c = curr[f];
      const sizeDelta = c.size - p.size;
      const lineDelta = c.lines - p.lines;
      console.log(`   ${f}`);
      console.log(`   ${DIM}Size: ${p.size}B → ${c.size}B (${sizeDelta >= 0 ? '+' : ''}${sizeDelta}B) | Lines: ${p.lines} → ${c.lines} (${lineDelta >= 0 ? '+' : ''}${lineDelta})${NC}`);

      // Show a simple text diff (first 5 changed lines)
      const prevLines = (p.content || '').split('\n');
      const currLines = c.content.split('\n');
      let shown = 0;
      for (let i = 0; i < Math.max(prevLines.length, currLines.length) && shown < 5; i++) {
        if (prevLines[i] !== currLines[i]) {
          if (prevLines[i] !== undefined) console.log(`   ${RED}- ${prevLines[i]}${NC}`);
          if (currLines[i] !== undefined) console.log(`   ${GREEN}+ ${currLines[i]}${NC}`);
          shown++;
        }
      }
      if (shown === 5 && prevLines.length !== currLines.length) console.log(`   ${DIM}... more changes${NC}`);
      console.log('');
    }
  }

  console.log('─'.repeat(50));
  console.log(`${BOLD}Added: ${added.length}  Removed: ${removed.length}  Changed: ${changed.length}  Unchanged: ${same.length}${NC}`);

  if (opts.output) {
    const report = { diffedAt: new Date().toISOString(), env, snapshotId: prev.id, added, removed, changed, unchanged: same };
    fs.writeFileSync(opts.output, JSON.stringify(report, null, 2));
    console.log(`\n📄 Report saved: ${opts.output}`);
  }
}

function listCommand() {
  const store = loadStore();
  const snaps = store.snapshots || [];

  console.log(`\n${BOLD}${CYAN}📋 infrasnap — Snapshots${NC}\n`);

  if (snaps.length === 0) {
    console.log('No snapshots yet. Run: node src/infrasnap.js snapshot [path]');
    return;
  }

  const byEnv = {};
  for (const s of snaps) {
    if (!byEnv[s.env]) byEnv[s.env] = [];
    byEnv[s.env].push(s);
  }

  for (const [env, envSnaps] of Object.entries(byEnv)) {
    console.log(`${BOLD}Environment: ${env}${NC} (${envSnaps.length} snapshot(s))`);
    envSnaps.slice(-5).forEach(s =>
      console.log(`  [${s.id}] ${s.timestamp.slice(0,19)}  ${s.fileCount} files  ${DIM}${s.label}${NC}`)
    );
    if (envSnaps.length > 5) console.log(`  ${DIM}... and ${envSnaps.length - 5} older${NC}`);
    console.log('');
  }
}

function watchCommand(targetPath, intervalSec, opts = {}) {
  const resolved = path.resolve(targetPath || '.');
  const env = opts.env || 'default';
  const interval = parseInt(intervalSec) || 30;

  console.log(`\n${BOLD}${CYAN}👁️  infrasnap — Watch Mode${NC}`);
  console.log(`Watching: ${resolved} | Env: ${env} | Interval: ${interval}s`);
  console.log('Press Ctrl+C to stop.\n');

  // Take initial snapshot
  snapshotCommand(targetPath, { env, label: 'watch-start' });

  setInterval(() => {
    const store = loadStore();
    const prev  = (store.environments[env] || []).slice(-1)[0];
    const curr  = buildFileMap(resolved);

    const changed = prev
      ? Object.keys(curr).filter(f => prev.files[f] && curr[f].hash !== prev.files[f].hash).length
      : 0;

    const ts = new Date().toISOString().slice(0,19);
    if (changed > 0) {
      console.log(`${YELLOW}[${ts}] ⚠️  ${changed} file(s) changed — taking snapshot${NC}`);
      snapshotCommand(targetPath, { env, label: `watch-auto-${Date.now()}` });
    } else {
      console.log(`${DIM}[${ts}] No changes${NC}`);
    }
  }, interval * 1000);
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const [,, cmd, arg1, ...rest] = process.argv;

function getOpt(flag) { const i = rest.indexOf(flag); return i !== -1 ? rest[i + 1] : null; }
const hasFlag = (flag) => rest.includes(flag);

if (!cmd || cmd === 'help') {
  console.log('infrasnap — Infrastructure Config Snapshot & Diff\n');
  console.log('Commands:');
  console.log('  snapshot [path] [--env name] [--label text]  Take a snapshot');
  console.log('  diff [path] [--env name] [--out file]        Diff vs last snapshot');
  console.log('  list                                          List all snapshots');
  console.log('  watch [path] [interval-sec] [--env name]     Watch for changes');
  console.log('\nExamples:');
  console.log('  node src/infrasnap.js snapshot .');
  console.log('  node src/infrasnap.js snapshot . --env production --label "before-deploy"');
  console.log('  node src/infrasnap.js diff . --env production');
  console.log('  node src/infrasnap.js watch . 60 --env staging');
  process.exit(0);
}

const envOpt   = getOpt('--env');
const labelOpt = getOpt('--label');
const outOpt   = getOpt('--out');

if (cmd === 'snapshot') snapshotCommand(arg1, { env: envOpt, label: labelOpt });
else if (cmd === 'diff') diffCommand(arg1, { env: envOpt, output: outOpt });
else if (cmd === 'list') listCommand();
else if (cmd === 'watch') watchCommand(arg1, rest[0], { env: envOpt });
else { console.error(`Unknown command: ${cmd}`); process.exit(1); }

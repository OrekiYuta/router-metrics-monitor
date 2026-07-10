#!/usr/bin/env node
/* =============================================================
 * router-metrics-collect.js  -- collector script (run with Node on a Windows PC)
 *
 * Flow:
 *   1. Read the .env config from the repository root
 *   2. SSH into the router via plink and collect three metrics:
 *        active connections / download speed / upload speed
 *   3. Append to public/data/YYYYMM.json (one file per month)
 *   4. git add (data + logs) + commit (local commit only, no push)
 *
 * Triggered by the Windows "Task Scheduler" every 1 minute by default
 * (see README / install-cronjob-windows.ps1 for deployment).
 * Pushing is handled by the separate git-push.js, run once per day by default.
 *
 * Dependency: plink (PuTTY). Install: choco install putty.portable
 * ============================================================= */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(REPO_DIR, '.env');
const LOG_DIR = path.join(REPO_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'collect.log');

// Format a Date as "YYYY-MM-DD HH:MM:SS" in China Standard Time (UTC+8),
// independent of the machine's local timezone.
function fmtCST(d = new Date()) {
  const t = new Date(d.getTime() + 8 * 3600 * 1000);
  return t.toISOString().slice(0, 19).replace('T', ' ');
}

function log(msg) {
  const line = `${fmtCST()} ${msg}`;
  console.log(line);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

function fail(msg) { log('ERROR: ' + msg); process.exit(1); }

// ---- Read .env ----
function loadEnv(file) {
  if (!fs.existsSync(file)) fail('.env not found; copy .env.example to .env and fill in the config.');
  const cfg = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    cfg[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return cfg;
}

const cfg = loadEnv(ENV_FILE);
const ROUTER_HOST = cfg.ROUTER_HOST || '192.168.1.1';
const ROUTER_USER = cfg.ROUTER_USER || 'root';
const ROUTER_PASS = cfg.ROUTER_PASS || '';
const HOSTKEY = cfg.ROUTER_HOSTKEY || '';
const WAN_IFACE = cfg.WAN_IFACE || 'pppoe-wan';
const SAMPLE_SECONDS = parseInt(cfg.SAMPLE_SECONDS || '5', 10);
const MAX_POINTS = parseInt(cfg.MAX_POINTS || '9000', 10);

// ---- Locate plink ----
function findPlink() {
  const candidates = [
    'C:\\ProgramData\\chocolatey\\bin\\plink.exe',
    'C:\\Program Files\\PuTTY\\plink.exe',
    'plink',
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['-V'], { stdio: 'ignore' });
      return c;
    } catch (_) { /* try next */ }
  }
  return null;
}
const PLINK = findPlink();
if (!PLINK) fail('plink not found; run choco install putty.portable first');

// ---- Remote command: get connection count + two byte samples ----
const remote = [
  'if [ -f /proc/sys/net/netfilter/nf_conntrack_count ]; then CONN=$(cat /proc/sys/net/netfilter/nf_conntrack_count);',
  'elif [ -f /proc/net/nf_conntrack ]; then CONN=$(wc -l < /proc/net/nf_conntrack); else CONN=0; fi',
  `RX1=$(cat /sys/class/net/${WAN_IFACE}/statistics/rx_bytes 2>/dev/null || echo 0)`,
  `TX1=$(cat /sys/class/net/${WAN_IFACE}/statistics/tx_bytes 2>/dev/null || echo 0)`,
  `sleep ${SAMPLE_SECONDS}`,
  `RX2=$(cat /sys/class/net/${WAN_IFACE}/statistics/rx_bytes 2>/dev/null || echo 0)`,
  `TX2=$(cat /sys/class/net/${WAN_IFACE}/statistics/tx_bytes 2>/dev/null || echo 0)`,
  'echo "$CONN $RX1 $TX1 $RX2 $TX2"',
].join('\n');

// ---- Run SSH ----
const args = ['-ssh', '-batch', '-pw', ROUTER_PASS];
if (HOSTKEY) args.push('-hostkey', HOSTKEY);
args.push(`${ROUTER_USER}@${ROUTER_HOST}`, remote);

let out;
try {
  out = execFileSync(PLINK, args, { encoding: 'utf8', timeout: (SAMPLE_SECONDS + 25) * 1000 });
} catch (e) {
  fail('SSH collection failed: ' + (e.stderr || e.message || e).toString().trim());
}

const line = out.split(/\r?\n/).reverse().find(l => /^\d+\s+\d+\s+\d+\s+\d+\s+\d+/.test(l));
if (!line) fail('Could not parse router response: ' + JSON.stringify(out));

const [conn, rx1, tx1, rx2, tx2] = line.trim().split(/\s+/).map(Number);
const down = Math.max(0, Math.floor((rx2 - rx1) / SAMPLE_SECONDS));
const up = Math.max(0, Math.floor((tx2 - tx1) / SAMPLE_SECONDS));
const ts = Math.floor(Date.now() / 1000);

// ---- Write the current month's data file ----
// Determine the month bucket using China Standard Time (UTC+8) so that files
// roll over at CST month boundaries regardless of the machine timezone.
const nowCST = new Date(Date.now() + 8 * 3600 * 1000);
const month = `${nowCST.getUTCFullYear()}${String(nowCST.getUTCMonth() + 1).padStart(2, '0')}`;
const dataDir = path.join(REPO_DIR, 'public', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dataFile = path.join(dataDir, `${month}.json`);

let list = [];
if (fs.existsSync(dataFile)) {
  try {
    const txt = fs.readFileSync(dataFile, 'utf8').replace(/^\uFEFF/, '').trim();
    if (txt) list = JSON.parse(txt);
    if (!Array.isArray(list)) list = [];
  } catch (e) {
    log('WARN: failed to parse existing data file, rebuilding: ' + e.message);
    list = [];
  }
}
list.push([ts, conn, down, up]);
if (MAX_POINTS > 0 && list.length > MAX_POINTS) {
  list = list.slice(list.length - MAX_POINTS);
}

// Compact JSON (no spaces, no BOM)
const json = '[' + list.map(r => '[' + r.join(',') + ']').join(',') + ']';
fs.writeFileSync(dataFile, json, 'utf8');

log(`collected conn=${conn} down=${down}B/s up=${up}B/s -> public/data/${month}.json (${list.length} pts)`);

// ---- git add + commit (local, no push) ----
function git(cmdArgs) {
  return execFileSync('git', cmdArgs, { cwd: REPO_DIR, encoding: 'utf8' });
}
try {
  // Include the data file and the log file in the same commit
  git(['add', `public/data/${month}.json`, 'logs/collect.log']);
  // diff --cached --quiet exits with code 1 when there are changes
  let changed = false;
  try { git(['diff', '--cached', '--quiet']); } catch (_) { changed = true; }
  if (changed) {
    git(['commit', '-m', `data: ${fmtCST()} conn=${conn} down=${down} up=${up}`]);
    log('committed');
  } else {
    log('no change to commit');
  }
} catch (e) {
  fail('git operation failed: ' + (e.stderr || e.message || e).toString().trim());
}

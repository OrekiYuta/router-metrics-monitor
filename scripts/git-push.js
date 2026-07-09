#!/usr/bin/env node
/* =============================================================
 * git-push.js  -- push script (run with Node on a Windows PC)
 *
 * Pushes all the commits accumulated locally by router-metrics-collect.js
 * to the remote in one go. Triggered once per day by the Windows
 * "Task Scheduler" by default.
 *
 * Prerequisites: the repo already has a configured remote (HTTPS with token
 *       or SSH both work), and router-metrics-collect.js has produced some
 *       local commits.
 * ============================================================= */

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(REPO_DIR, '.env');
const LOG_DIR = path.join(REPO_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'push.log');

function log(msg) {
  const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} ${msg}`;
  console.log(line);
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

// Read branch (default main)
let branch = 'main';
if (fs.existsSync(ENV_FILE)) {
  for (const raw of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = raw.trim().match(/^GIT_BRANCH\s*=\s*(.+)$/);
    if (m) branch = m[1].trim();
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' });
}

try {
  // First stage any uncommitted logs into a commit (so logs also enter the repo)
  try {
    git(['add', 'logs']);
    let changed = false;
    try { git(['diff', '--cached', '--quiet']); } catch (_) { changed = true; }
    if (changed) {
      git(['commit', '-m', `ci: ${new Date().toISOString().slice(0, 19).replace('T', ' ')} auto push`]);
    }
  } catch (_) { /* no logs or no changes, ignore */ }

  // Count unpushed commits (ignore errors when there is no remote tracking)
  let ahead = 'unknown';
  try { ahead = git(['rev-list', '--count', `origin/${branch}..HEAD`]).trim(); } catch (_) {}

  if (ahead === '0') { log('nothing to push'); process.exit(0); }

  git(['push', 'origin', branch]);
  log(`pushed OK (ahead was ${ahead} commits)`);
} catch (e) {
  log('push FAILED: ' + (e.stderr || e.message || e).toString().trim());
  process.exit(1);
}

#!/usr/bin/env node
// web-to-figma capture — drives agent-browser (own Chromium, per-user profile in ~/.web-to-figma).
//   node capture.js open    --url <url> [--login] [--width 1440 --height 900]
//   node capture.js extract [--viewport-only]
// `open` loads the page headless; if it lands on a sign-in screen (or --login is given) it reopens
// in a visible window so the user can sign in — the login persists in the profile for next time.
// `extract` first expands the page (expand.js: scrolls every scroll container, lifts height limits so the
// whole content lays out as one tall page), extracts, then restores the page. Saves page.json under ~/.web-to-figma/pages;
// the JSON never passes through the agent's context, only a one-line summary is printed.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const state = require('./state');

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = name => { const i = argv.indexOf(name); return i < 0 ? undefined : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
if (!['open', 'extract'].includes(cmd)) {
  console.error('usage: capture.js open --url U [--login] [--width W --height H] | extract [--viewport-only]');
  process.exit(1);
}

const EXTRACT = fs.readFileSync(path.join(__dirname, 'extract.js'), 'utf8');
const EXPAND = fs.readFileSync(path.join(__dirname, 'expand.js'), 'utf8');
const RESTORE = 'window.__w2fRestore ? (window.__w2fRestore(), "restored") : "nothing to restore"';
// Heuristic sign-in detection: a visible password field, or a login-ish path.
const LOGIN_PROBE = 'JSON.stringify({url:location.href,title:document.title,login:!![...document.querySelectorAll("input[type=password]")].some(e=>e.offsetParent)||/\\/(login|signin|sign-in|auth)(\\/|$|\\?)/i.test(location.pathname)})';
const SESSION = 'web-to-figma';

const ab = (args, input) => execFileSync('agent-browser', ['--session', SESSION, ...args], {
  encoding: 'utf8', input, maxBuffer: 64 << 20, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
});
const evalJson = code => JSON.parse(ab(['eval', '--stdin'], code)); // eval prints the JS result JSON-encoded

function launch(url, headed, width, height) {
  // Launch flags (headed/profile) only apply to a fresh browser, so restart the session.
  try { ab(['close']); } catch { /* not running */ }
  ab(['--profile', state.profileDir, ...(headed ? ['--headed'] : []), 'open', url]);
  ab(['set', 'viewport', String(width), String(height)]);
  try { ab(['wait', '--load', 'networkidle']); } catch { /* long-polling pages never go idle */ }
  return JSON.parse(evalJson(LOGIN_PROBE));
}

try {
  if (cmd === 'open') {
    const url = flag('--url');
    if (!url) throw new Error('--url is required');
    const width = Number(flag('--width') || 1440), height = Number(flag('--height') || 900);
    let headed = !!flag('--login');
    let probe = launch(url, headed, width, height);
    if (probe.login && !headed) { headed = true; probe = launch(url, true, width, height); }
    // waitForUser: the agent must ask the user to sign in / set up the screen before extracting.
    console.log(JSON.stringify({ ok: true, url: probe.url, title: probe.title, headed, loginRequired: probe.login, waitForUser: headed, viewport: { width, height } }));
  } else {
    const expanded = flag('--viewport-only') ? null : JSON.parse(evalJson(EXPAND));
    let raw;
    try { raw = evalJson(EXTRACT); } finally { if (expanded) evalJson(RESTORE); }
    const page = JSON.parse(raw);
    const file = state.newPagePath(page.meta.url);
    fs.writeFileSync(file, raw);
    let nodes = 0, auto = 0;
    (function walk(n) { nodes++; if (n.lay) auto++; (n.ch || []).forEach(walk); })(page.root);
    console.log(JSON.stringify({
      ok: true, file, url: page.meta.url, title: page.meta.title, page: page.meta.page, expanded,
      nodes, autoLayoutFrames: auto, colors: Object.keys(page.tokens.colors).length, textStyles: Object.keys(page.tokens.text).length, bytes: raw.length,
    }));
  }
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: String((e.stderr && e.stderr.toString().trim()) || e.message).slice(0, 500) }));
  process.exit(1);
}

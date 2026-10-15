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
const os = require('os');
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

const AB_DIR = path.join(os.homedir(), '.agent-browser'); // agent-browser state/socket dir
let step = 'init'; // reported on failure

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const errText = e => String((e.stderr && e.stderr.toString().trim()) || e.message);

const run = (args, input) => execFileSync('agent-browser', ['--session', SESSION, ...args], {
  encoding: 'utf8', input, maxBuffer: 64 << 20, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
});
// agent-browser ≥0.39 shuts the daemon down on `close`; a command sent while it is still exiting
// gets no reply ("EOF while parsing"). It did not run, so one retry is safe.
function ab(args, input) {
  try { return run(args, input); } catch (e) {
    if (!/EOF while parsing|no response came back/.test(errText(e))) throw e;
    sleep(1500);
    return run(args, input);
  }
}
const evalJson = code => JSON.parse(ab(['eval', '--stdin'], code)); // eval prints the JS result JSON-encoded

function daemonPid() {
  try { const pid = Number(fs.readFileSync(path.join(AB_DIR, `${SESSION}.pid`), 'utf8').trim()); return pid && alive(pid) ? pid : null; } catch { return null; }
}

// Chrome refuses a profile another process holds (SingletonLock -> "<host>-<pid>"). Wait for the
// previous browser to let go; clear the lock if its owner is already gone.
function waitProfileUnlocked() {
  const lock = path.join(state.profileDir, 'SingletonLock');
  for (let i = 0; i < 50; i++) {
    let target; try { target = fs.readlinkSync(lock); } catch { return; }
    const pid = Number(String(target).split('-').pop());
    if (!pid || !alive(pid)) {
      for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) { try { fs.rmSync(path.join(state.profileDir, f)); } catch { /* absent */ } }
      return;
    }
    sleep(100);
  }
  throw new Error('브라우저 프로필을 다른 브라우저가 사용 중입니다. 다른 세션에서 web-to-figma 브라우저를 닫고 다시 시도해 주세요.');
}

// Launch flags (headed/profile) only apply to a fresh browser, so stop any running session first.
// Never `close` when nothing runs: that only spawns a bare daemon and breaks the next launch.
function stopSession() {
  const pid = daemonPid();
  if (pid) {
    try { run(['close']); } catch { /* already closing */ }
    for (let i = 0; i < 30 && alive(pid) && fs.existsSync(path.join(AB_DIR, `${SESSION}.sock`)); i++) sleep(100);
  }
  waitProfileUnlocked();
}

function launch(url, headed, width, height) {
  step = 'close previous browser'; stopSession();
  step = headed ? 'open (window)' : 'open (headless)';
  ab(['--profile', state.profileDir, ...(headed ? ['--headed'] : []), 'open', url]);
  step = 'set viewport'; ab(['set', 'viewport', String(width), String(height)]);
  step = 'wait for load';
  try { run(['wait', '--load', 'networkidle']); } catch { /* long-polling pages never go idle */ }
  step = 'login check'; return JSON.parse(evalJson(LOGIN_PROBE));
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
    step = 'expand page'; const expanded = flag('--viewport-only') ? null : JSON.parse(evalJson(EXPAND));
    let raw;
    step = 'extract';
    try { raw = evalJson(EXTRACT); } finally { if (expanded) { step = 'restore page'; evalJson(RESTORE); } }
    step = 'save';
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
  const hint = /EOF while parsing|no response came back|crash/i.test(errText(e)) ? 'agent-browser doctor 를 실행해 보세요' : undefined;
  console.log(JSON.stringify({ ok: false, step, error: errText(e).slice(0, 500), ...(hint ? { hint } : {}) }));
  process.exit(1);
}

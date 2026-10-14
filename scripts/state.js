#!/usr/bin/env node
// web-to-figma per-user state, kept outside the (shared) skill folder:
//   $W2F_HOME (default ~/.web-to-figma)/history.json        last inputs, offered for reuse
//   $W2F_HOME/pages/<host>/<timestamp>.json             extracted pages, newest KEEP per host
//   $W2F_HOME/browser-profile/                          agent-browser login state
// CLI:
//   node state.js history
//   node state.js remember --url <url> [--figma <fileUrl>] [--login]
//   node state.js latest-page [--url <url>]
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.W2F_HOME || path.join(os.homedir(), '.web-to-figma');
const KEEP = 5;
const historyFile = path.join(HOME, 'history.json');

function readHistory() {
  try { return JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch { return { last: null, recent: [] }; }
}

function remember(entry) {
  const h = readHistory();
  const e = { ...entry, at: new Date().toISOString() };
  h.last = e;
  h.recent = [e, ...h.recent.filter(r => r.url !== e.url)].slice(0, 10);
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(historyFile, JSON.stringify(h, null, 2));
  return h;
}

const hostOf = url => { try { return new URL(url).hostname || 'local'; } catch { return 'unknown'; } };

// Path for a new extraction; prunes older ones for the same host.
function newPagePath(url) {
  const dir = path.join(HOME, 'pages', hostOf(url));
  fs.mkdirSync(dir, { recursive: true });
  const old = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  for (const f of old.slice(0, Math.max(0, old.length - (KEEP - 1)))) fs.rmSync(path.join(dir, f));
  return path.join(dir, new Date().toISOString().replace(/[:.]/g, '-') + '.json');
}

function latestPage(url) {
  const root = path.join(HOME, 'pages');
  const dirs = url ? [path.join(root, hostOf(url))] : (fs.existsSync(root) ? fs.readdirSync(root).map(d => path.join(root, d)) : []);
  const files = dirs.filter(fs.existsSync).flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => path.join(d, f)));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

module.exports = { HOME, readHistory, remember, newPagePath, latestPage, profileDir: path.join(HOME, 'browser-profile') };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = name => { const i = rest.indexOf(name); return i < 0 ? undefined : (rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : true); };
  if (cmd === 'history') console.log(JSON.stringify(readHistory(), null, 2));
  else if (cmd === 'remember') console.log(JSON.stringify(remember({ url: flag('--url'), figma: flag('--figma'), login: !!flag('--login') }).last));
  else if (cmd === 'latest-page') console.log(latestPage(flag('--url')) || '');
  else { console.error('usage: state.js history | remember --url U [--figma F] [--login] | latest-page [--url U]'); process.exit(1); }
}

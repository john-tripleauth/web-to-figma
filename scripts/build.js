#!/usr/bin/env node
// web-to-figma build — page.json → what Figma needs to draw it.
// Usage:
//   node build.js <page.json> --payload                      → full draw payload on stdout (carrier.js packs it)
//   node build.js <page.json> --scripts <outDir> [--chunk 220] → use_figma scripts 00-setup.js, 01-*.js …
//                                                               (each file is passed verbatim as use_figma `code`)
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const input = argv[0];
const flag = name => { const i = argv.indexOf(name); return i < 0 ? undefined : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const mode = flag('--payload') ? 'payload' : flag('--scripts') ? 'scripts' : null;
if (!input || !mode) { console.error('usage: build.js <page.json> --payload | --scripts <outDir> [--chunk N]'); process.exit(1); }
const outDir = mode === 'scripts' ? (flag('--scripts') === true ? 'out/figma' : flag('--scripts')) : null;
// use_figma accepts ≤50k chars of code per call; ~220 nodes keeps a chunk well under that.
const LIMIT = Number(flag('--chunk') || 220);

const page = JSON.parse(fs.readFileSync(input, 'utf8'));
const runtimePath = path.join(__dirname, 'figma-runtime.js');
// Minify when esbuild is reachable (≈ -50% tokens per script); fall back to the readable source.
// Each script only carries the runtime part it calls (common + setup | common + chunk).
const src = fs.readFileSync(runtimePath, 'utf8');
const [common, rest2] = src.split('//#setup');
const [setupPart, rest3] = rest2.split('//#chunk');
const [chunkPart] = rest3.split('//#drawall');
function minify(code) {
  try {
    return require('child_process').execSync('npx -y esbuild --minify --log-level=error', { input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 60000 });
  } catch (e) { return code; }
}
const run = 'w2f-' + Buffer.from(page.meta.url + page.meta.at).toString('base64').replace(/[^a-z0-9]/gi, '').slice(-10);

// ---------- token names ----------
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const colors = {};
for (const [id, hex] of Object.entries(page.tokens.colors)) colors[id] = { hex, name: 'color/' + hex.slice(1) };
const text = {};
const usedNames = new Set();
for (const [id, t] of Object.entries(page.tokens.text)) {
  let name = `text/${t.fs} ${WEIGHT_NAMES[Math.round(t.fw / 100) * 100] || t.fw}` + (t.lh ? ` · ${t.lh}` : '') + (t.ls ? ` · ls${t.ls}` : '') + (t.it ? ' Italic' : '');
  let k = name, i = 2; while (usedNames.has(k)) k = `${name} (${i++})`;
  usedNames.add(k);
  text[id] = { ...t, name: k };
}

const meta = { run, title: page.meta.title, url: page.meta.url };

// ---------- payload: full tree, drawn in one pass by wrDrawAll (see carrier.js) ----------
if (mode === 'payload') {
  process.stdout.write(JSON.stringify({ ...meta, tokens: { colors, text }, tree: page.root }));
  process.exit(0);
}

// ---------- chunk planning ----------
const size = n => 1 + (n.ch || []).reduce((a, c) => a + size(c), 0);
const items = []; // { key, node }
let phSeq = 0;
function plan(n, isRoot) {
  if (!isRoot && (size(n) <= LIMIT || !n.ch || !n.ch.length)) {
    const key = `${run}:${++phSeq}`;
    items.push({ key, node: n });
    return { ph: key, n: n.n, w: n.w, h: n.h, ...(n.x !== undefined ? { x: n.x, y: n.y } : {}) };
  }
  const { ch, ...props } = n;
  return { ...props, ch: (ch || []).map(c => plan(c)) };
}
const tree = plan(page.root, true);

// group consecutive items into scripts of ~LIMIT nodes
const groups = [];
let cur = [], curSize = 0;
for (const it of items) {
  const s = size(it.node);
  if (cur.length && curSize + s > LIMIT) { groups.push(cur); cur = []; curSize = 0; }
  cur.push(it); curSize += s;
}
if (cur.length) groups.push(cur);

// ---------- emit ----------
function usedTokens(nodes) {
  const c = new Set(), t = new Set(), s = new Set();
  const visit = n => {
    const addC = v => { if (typeof v === 'string' && colors[v]) c.add(v); };
    addC(n.fill); addC(n.c);
    if (n.fill && n.fill.lg) n.fill.lg.s.forEach(st => addC(st[0]));
    if (n.bd) addC(n.bd.c);
    (n.sh || []).forEach(sh => addC(sh[0]));
    if (n.st) t.add(n.st);
    (n.seg || []).forEach(([, , sid, cid]) => { if (sid) t.add(sid); addC(cid); });
    (n.ch || []).forEach(visit);
  };
  nodes.forEach(visit);
  const pick = (obj, keys) => Object.fromEntries([...keys].map(k => [k, obj[k]]));
  return {
    tokens: { colors: pick(colors, c), text: Object.fromEntries([...t].map(k => [k, { name: text[k].name }])) },
  };
}

const runtimes = { wrSetup: minify(common + setupPart), wrChunk: minify(common + chunkPart) };
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const slug = s => s.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 24) || 'part';
const emit = (file, data, call) => {
  const code = `${runtimes[call]}\nconst DATA = ${JSON.stringify(data)};\nreturn await ${call}();\n`;
  fs.writeFileSync(path.join(outDir, file), code);
  return { file, bytes: code.length };
};

const files = [];
// setup carries the full token set and the shell tree (no leaf content)
files.push(emit('00-setup.js', { ...meta, mode: 'setup', tokens: { colors, text }, tree }, 'wrSetup'));
groups.forEach((g, i) => {
  const { tokens } = usedTokens(g.map(it => it.node));
  const name = `${String(i + 1).padStart(2, '0')}-${slug(g[0].node.n)}.js`;
  files.push(emit(name, { ...meta, mode: 'chunk', tokens, items: g }, 'wrChunk'));
});

const manifest = { run, url: page.meta.url, page: page.meta.page, nodes: size(page.root), chunkLimit: LIMIT, files: files.map((f, i) => ({ ...f, nodes: i === 0 ? null : groups[i - 1].reduce((a, it) => a + size(it.node), 0) })) };
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));

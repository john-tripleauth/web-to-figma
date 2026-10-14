#!/usr/bin/env node
// web-to-figma carrier — packs the renderer + page data into an SVG whose layer names hold the
// base64 source, so it reaches Figma through upload_assets (curl) instead of model output.
// figma/bootstrap.js (a small fixed use_figma script) reads the layer names back and runs them.
// Usage: node carrier.js <page.json> --post <submitUrl>   (or --out file.svg to only write it)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const input = argv[0];
const submitUrl = flag('--post');
const outFile = flag('--out');
if (!input || (!submitUrl && !outFile)) { console.error('usage: carrier.js <page.json> --post <submitUrl> | --out <file.svg>'); process.exit(1); }

const CHUNK = 4000; // characters of base64 per layer name
const payload = execFileSync(process.execPath, [path.join(__dirname, 'build.js'), input, '--payload'], { encoding: 'utf8', maxBuffer: 64 << 20 });
const runtime = fs.readFileSync(path.join(__dirname, 'figma-runtime.js'), 'utf8');
try { JSON.parse(payload); } catch (e) { console.error(`payload is not valid JSON (${payload.length} chars): ${e.message}`); process.exit(1); }
const src = `const DATA = ${payload};\n${runtime}\nreturn await wrDrawAll();\n`;
// Same wrapping as figma/bootstrap.js — fail here instead of inside Figma.
try { new Function('figma', `return (async () => {\n${src}\n})()`); } catch (e) { console.error(`carrier source does not parse: ${e.message}`); process.exit(1); }

const b64 = Buffer.from(src, 'utf8').toString('base64');
const parts = b64.match(new RegExp(`.{1,${CHUNK}}`, 'g'));
const rects = parts.map((p, i) => `<rect id="wr${String(i).padStart(4, '0')}_${p}" x="${i}" width="1" height="1"/>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${parts.length}" height="1">${rects}</svg>`;
const name = `web-to-figma-carrier-${Date.now()}`;

(async () => {
  if (outFile) { fs.writeFileSync(outFile, svg); console.log(JSON.stringify({ file: outFile, name, parts: parts.length, bytes: svg.length })); return; }
  const form = new FormData();
  form.append('file', new Blob([svg], { type: 'image/svg+xml' }), name + '.svg');
  const res = await fetch(submitUrl, { method: 'POST', body: form });
  const body = await res.text();
  if (!res.ok) { console.error(`upload failed ${res.status}: ${body}`); process.exit(1); }
  console.log(JSON.stringify({ name, parts: parts.length, bytes: svg.length, upload: JSON.parse(body) }));
})();

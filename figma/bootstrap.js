// web-to-figma bootstrap — pass this file verbatim as use_figma `code` after carrier.js uploaded an SVG.
// Finds the newest web-to-figma-carrier layer, decodes its layer names, removes it and runs the payload.
let page = null, carrier = null;
for (const p of figma.root.children) {
  await p.loadAsync();
  for (const n of p.children) if (n.name.startsWith('web-to-figma-carrier-') && (!carrier || n.name > carrier.name)) { carrier = n; page = p; }
}
if (!carrier) throw new Error('web-to-figma carrier not found — upload it with scripts/carrier.js first');
await figma.setCurrentPageAsync(page);
const b64 = carrier.findAll(n => /^wr\d{4}_/.test(n.name)).map(n => n.name).sort().map(s => s.slice(7)).join('');
for (const n of page.children.filter(n => n.name.startsWith('web-to-figma-carrier-'))) n.remove();
const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B = []; let acc = 0, bits = 0;
for (const ch of b64) { if (ch === '=') break; acc = ((acc << 6) | T.indexOf(ch)) & 0xffffff; bits += 6; if (bits >= 8) { bits -= 8; B.push((acc >> bits) & 255); } }
let src = '';
for (let i = 0; i < B.length;) {
  const b = B[i++];
  if (b < 128) src += String.fromCharCode(b);
  else if (b < 224) src += String.fromCharCode(((b & 31) << 6) | (B[i++] & 63));
  else if (b < 240) src += String.fromCharCode(((b & 15) << 12) | ((B[i++] & 63) << 6) | (B[i++] & 63));
  else src += String.fromCodePoint(((b & 7) << 18) | ((B[i++] & 63) << 12) | ((B[i++] & 63) << 6) | (B[i++] & 63));
}
return await new Function('figma', `return (async () => {\n${src}\n})()`)(figma);

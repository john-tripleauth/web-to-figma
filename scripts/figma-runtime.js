// web-to-figma Figma runtime — prepended to every generated use_figma script by build.js.
// Expects a global `DATA` = { run, mode: 'setup'|'chunk', ... } defined after this block.

// Nodes are tracked by name (pluginData is unavailable in use_figma): root ends with `[run]`, placeholders are `⏳ run:N`.
const wrRootName = () => `${DATA.title} [${DATA.run}]`;
const wrFindRoot = () => figma.currentPage.children.find(n => n.name.endsWith(`[${DATA.run}]`));
const hexRgb = h => ({ r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255, a: h.length > 7 ? parseInt(h.slice(7, 9), 16) / 255 : 1 });

async function wrContext() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const col = cols.find(c => c.name === 'web-to-figma colors');
  const vars = new Map();
  if (col) for (const id of col.variableIds) { const v = await figma.variables.getVariableByIdAsync(id); if (v) vars.set(v.name, v); }
  const styles = new Map((await figma.getLocalTextStylesAsync()).map(s => [s.name, s]));
  return { col, vars, styles };
}

function wrPaint(ctx, cid) {
  const c = DATA.tokens.colors[cid]; if (!c) return null;
  const { r, g, b, a } = hexRgb(c.hex);
  let p = { type: 'SOLID', color: { r, g, b }, opacity: a };
  const v = ctx.vars.get(c.name);
  if (v) p = figma.variables.setBoundVariableForPaint(p, 'color', v);
  return p;
}

async function wrFill(ctx, f) {
  if (!f) return [];
  if (typeof f === 'string') { const p = wrPaint(ctx, f); return p ? [p] : []; }
  if (f.lg) {
    const rad = (f.lg.a - 90) * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
    return [{
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[c, s, 0.5 - 0.5 * c - 0.5 * s], [-s, c, 0.5 + 0.5 * s - 0.5 * c]],
      gradientStops: f.lg.s.map(([cid, pos]) => ({ position: Math.min(1, Math.max(0, pos)), color: hexRgb(DATA.tokens.colors[cid].hex) })),
    }];
  }
  return [];
}

async function wrApplyFrame(ctx, node, n) {
  node.name = n.n;
  if (n.lay) {
    node.layoutMode = n.lay.d === 'H' ? 'HORIZONTAL' : 'VERTICAL';
    node.resize(Math.max(1, n.w), Math.max(1, n.h));
    node.primaryAxisSizingMode = 'FIXED';
    node.counterAxisSizingMode = 'FIXED';
    node.itemSpacing = n.lay.g || 0;
    const [pt, pr, pb, pl] = (n.lay.p || [0, 0, 0, 0]).map(v => Math.max(0, v)); // Figma rejects negative padding
    Object.assign(node, { paddingTop: pt, paddingRight: pr, paddingBottom: pb, paddingLeft: pl });
    node.primaryAxisAlignItems = 'MIN';
    node.counterAxisAlignItems = n.lay.a || 'MIN';
  } else node.resize(Math.max(1, n.w), Math.max(1, n.h));
  node.fills = await wrFill(ctx, n.fill);
  node.clipsContent = !!n.clip;
  if (n.r !== undefined) {
    if (Array.isArray(n.r)) [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius] = n.r;
    else node.cornerRadius = n.r;
  }
  if (n.bd) {
    const p = wrPaint(ctx, n.bd.c);
    if (p) {
      node.strokes = [p];
      node.strokeAlign = n.bd.out ? 'OUTSIDE' : 'INSIDE';
      if (Array.isArray(n.bd.w)) [node.strokeTopWeight, node.strokeRightWeight, node.strokeBottomWeight, node.strokeLeftWeight] = n.bd.w;
      else node.strokeWeight = n.bd.w;
    }
  }
  if (n.sh) node.effects = n.sh.map(([cid, x, y, blur, spread, inset]) => ({
    type: inset ? 'INNER_SHADOW' : 'DROP_SHADOW', color: hexRgb(DATA.tokens.colors[cid].hex), offset: { x, y },
    radius: blur, spread, visible: true, blendMode: 'NORMAL', ...(inset ? {} : { showShadowBehindNode: false }),
  }));
  if (n.op !== undefined) node.opacity = n.op;
}

async function wrText(ctx, n) {
  const t = figma.createText();
  const st = ctx.styles.get(DATA.tokens.text[n.st].name);
  t.fontName = st.fontName;
  t.characters = n.tx;
  await t.setTextStyleIdAsync(st.id);
  const p = wrPaint(ctx, n.c); t.fills = p ? [p] : [];
  for (const [s, e, sid, cid] of n.seg || []) {
    if (sid) { const ss = ctx.styles.get(DATA.tokens.text[sid].name); await t.setRangeTextStyleIdAsync(s, e, ss.id); }
    if (cid) { const cp = wrPaint(ctx, cid); if (cp) t.setRangeFills(s, e, [cp]); }
  }
  t.name = n.n;
  if (n.wrap) { t.resize(Math.max(1, n.w), Math.max(1, n.h)); t.textAutoResize = 'HEIGHT'; }
  else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  if (n.al) t.textAlignHorizontal = n.al;
  if (n.op !== undefined) t.opacity = n.op;
  return t;
}

let wrCount = 0;
async function wrBuild(ctx, n, parent, index) {
  let node;
  if (n.t === 'text') node = await wrText(ctx, n);
  else {
    node = figma.createFrame();
    await wrApplyFrame(ctx, node, n);
  }
  if (index === undefined) parent.appendChild(node); else parent.insertChild(index, node);
  if (parent.layoutMode === 'NONE' || !parent.layoutMode) { node.x = n.x || 0; node.y = n.y || 0; }
  wrCount++;
  if (n.t === 'frame' && n.ch) for (const c of n.ch) await wrBuild(ctx, c, node);
  return node;
}

async function wrLoadFonts(ctx) {
  const fonts = new Map();
  for (const t of Object.values(DATA.tokens.text)) { const s = ctx.styles.get(t.name); if (s) fonts.set(JSON.stringify(s.fontName), s.fontName); }
  await Promise.all([...fonts.values()].map(f => figma.loadFontAsync(f)));
}

//#setup
// Text always uses Figma's default family; only the weight is mapped to a style.
const WR_FONT = 'Inter';
const WR_STYLES = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
// Color variables + text styles (idempotent: matched by name).
async function wrTokens() {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  let col = cols.find(c => c.name === 'web-to-figma colors') || figma.variables.createVariableCollection('web-to-figma colors');
  const modeId = col.modes[0].modeId;
  const existing = new Map();
  for (const id of col.variableIds) { const v = await figma.variables.getVariableByIdAsync(id); if (v) existing.set(v.name, v); }
  for (const c of Object.values(DATA.tokens.colors)) {
    let v = existing.get(c.name);
    if (!v) { v = figma.variables.createVariable(c.name, col, 'COLOR'); v.scopes = ['ALL_FILLS', 'STROKE_COLOR', 'EFFECT_COLOR']; existing.set(c.name, v); }
    v.setValueForMode(modeId, hexRgb(c.hex));
  }

  // text styles
  const styles = new Map((await figma.getLocalTextStylesAsync()).map(s => [s.name, s]));
  for (const t of Object.values(DATA.tokens.text)) {
    const w = WR_STYLES[Math.min(900, Math.max(100, Math.round(t.fw / 100) * 100))];
    const fontName = { family: WR_FONT, style: t.it ? (w === 'Regular' ? 'Italic' : w + ' Italic') : w };
    await figma.loadFontAsync(fontName);
    const s = styles.get(t.name) || figma.createTextStyle();
    s.name = t.name; s.fontName = fontName; s.fontSize = t.fs;
    s.lineHeight = t.lh ? { unit: 'PIXELS', value: t.lh } : { unit: 'AUTO' };
    s.letterSpacing = { unit: 'PIXELS', value: t.ls || 0 };
    styles.set(t.name, s);
  }
}

async function wrSetup() {
  await wrTokens();
  // root + shells + placeholders
  const ctx = await wrContext();
  for (const old of figma.currentPage.children.filter(n => n.name.endsWith(`[${DATA.run}]`))) old.remove();
  const right = figma.currentPage.children.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const created = [];
  async function shell(s, parent) {
    const node = figma.createFrame();
    if (s.ph) {
      node.name = '⏳ ' + s.ph; node.resize(Math.max(1, s.w), Math.max(1, s.h)); node.fills = [];
      node.placeholder = true;
    } else await wrApplyFrame(ctx, node, s);
    parent.appendChild(node);
    if (!parent.layoutMode || parent.layoutMode === 'NONE') { node.x = s.x || 0; node.y = s.y || 0; }
    created.push(node.id);
    for (const c of s.ch || []) await shell(c, node);
    return node;
  }
  const root = await shell(DATA.tree, figma.currentPage);
  root.x = right ? right + 200 : 0; root.y = 0;
  root.name = wrRootName();
  figma.viewport.scrollAndZoomIntoView([root]);
  return { rootId: root.id, created: created.length, colors: Object.keys(DATA.tokens.colors).length, textStyles: Object.keys(DATA.tokens.text).length };
}

//#chunk
async function wrChunk() {
  const ctx = await wrContext();
  await wrLoadFonts(ctx);
  const root = wrFindRoot();
  if (!root) throw new Error('web-to-figma root not found on current page — run 00-setup first');
  const out = [];
  for (const item of DATA.items) {
    const target = root.findOne(n => n.name === '⏳ ' + item.key);
    if (!target) { out.push({ key: item.key, skipped: 'already built' }); continue; }
    const parent = target.parent, index = parent.children.indexOf(target);
    let node;
    try { node = await wrBuild(ctx, item.node, parent, index); }
    catch (e) {
      // keep the run retry-safe: drop the half-built subtree, leave the placeholder
      const partial = parent.children[index]; if (partial && partial !== target) partial.remove();
      throw e;
    }
    if (!parent.layoutMode || parent.layoutMode === 'NONE') { node.x = target.x; node.y = target.y; }
    target.remove();
    out.push({ key: item.key, id: node.id });
  }
  return { rootId: root.id, built: out, nodes: wrCount };
}

//#drawall
// Full draw in one pass — used by figma/bootstrap.js, where code and data arrive via the
// uploaded carrier SVG instead of being inlined into the script.
async function wrDrawAll() {
  const t0 = Date.now();
  await wrTokens();
  const ctx = await wrContext();
  await wrLoadFonts(ctx);
  for (const old of figma.currentPage.children.filter(n => n.name.endsWith(`[${DATA.run}]`))) old.remove();
  const right = figma.currentPage.children.reduce((m, n) => Math.max(m, n.x + n.width), 0);
  const root = await wrBuild(ctx, DATA.tree, figma.currentPage);
  root.x = right ? right + 200 : 0; root.y = 0;
  root.name = wrRootName();
  figma.viewport.scrollAndZoomIntoView([root]);
  return { rootId: root.id, nodes: wrCount, ms: Date.now() - t0 };
}

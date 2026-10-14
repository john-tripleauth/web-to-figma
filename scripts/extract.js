// web-to-figma extractor — runs inside the page (agent-browser eval --stdin).
// Walks the rendered DOM and emits a Figma-shaped tree (see schema/page.schema.json).
// Returns a JSON string.
(() => {
  const SX = window.scrollX, SY = window.scrollY;

  // ---------- colors (canvas normalizes oklch/oklab/lab/rgb → sRGB) ----------
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map();
  const hex2 = n => n.toString(16).padStart(2, '0');
  function toHex(str) {
    if (!str || str === 'transparent' || str === 'none') return null;
    if (colorCache.has(str)) return colorCache.get(str);
    let out = null;
    const m = str.match(/\/\s*([\d.]+%?)\s*\)$/) || str.match(/^rgba\(.*,\s*([\d.]+)\s*\)$/);
    let a = 1;
    if (m) a = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
    if (a > 0.004) {
      cx.clearRect(0, 0, 1, 1);
      cx.globalAlpha = 1;
      cx.fillStyle = '#000';
      cx.fillStyle = str;
      // paint opaque version so rgb survives readback; alpha tracked separately
      const opaque = cx.fillStyle;
      cx.fillStyle = opaque;
      cx.globalAlpha = 1;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      let rgb = [d[0], d[1], d[2]];
      if (d[3] > 0 && d[3] < 255) rgb = rgb.map(v => Math.min(255, Math.round(v * 255 / d[3])));
      const alpha = d[3] < 255 ? d[3] / 255 : a;
      out = '#' + rgb.map(hex2).join('') + (alpha < 0.996 ? hex2(Math.round(alpha * 255)) : '');
    }
    colorCache.set(str, out);
    return out;
  }

  // ---------- tokens ----------
  const colors = {}, colorIds = new Map();
  function cid(str) {
    const h = typeof str === 'string' && str.startsWith('#') ? str : toHex(str);
    if (!h) return null;
    if (!colorIds.has(h)) { const id = 'c' + (colorIds.size + 1); colorIds.set(h, id); colors[id] = h; }
    return colorIds.get(h);
  }
  const textStyles = {}, textIds = new Map();
  function sid(cs) {
    const fs = parseFloat(cs.fontSize), fw = parseInt(cs.fontWeight, 10) || 400;
    const lh = cs.lineHeight === 'normal' ? null : Math.round(parseFloat(cs.lineHeight) * 10) / 10;
    const ls = cs.letterSpacing === 'normal' ? 0 : Math.round(parseFloat(cs.letterSpacing) * 100) / 100;
    const it = cs.fontStyle === 'italic' ? 1 : 0;
    const key = [fs, fw, lh, ls, it].join('|');
    if (!textIds.has(key)) {
      const id = 't' + (textIds.size + 1); textIds.set(key, id);
      textStyles[id] = { fs, fw, lh, ls, ...(it ? { it } : {}) };
    }
    return textIds.get(key);
  }

  // ---------- helpers ----------
  const R = v => Math.round(v);
  const box = r => ({ ax: R(r.left + SX), ay: R(r.top + SY), w: R(r.width), h: R(r.height) });
  function splitTop(s) { // split on commas not inside parens
    const out = []; let depth = 0, cur = '';
    for (const ch of s) {
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function shadows(cs) {
    if (cs.boxShadow === 'none') return null;
    const res = [];
    for (const part of splitTop(cs.boxShadow)) {
      const inset = /\binset\b/.test(part);
      const colorMatch = part.match(/^(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|lab\([^)]*\)|#[0-9a-f]+)/i);
      const color = colorMatch ? colorMatch[1] : 'rgb(0,0,0)';
      const c = cid(color); if (!c) continue;
      const nums = part.replace(colorMatch ? colorMatch[1] : '', '').match(/-?[\d.]+px/g) || [];
      const [x, y, b, s] = nums.map(parseFloat).concat([0, 0, 0, 0]);
      res.push([c, x, y, b, s, inset ? 1 : 0]);
    }
    return res.length ? res : null;
  }
  function gradient(bg) {
    const m = bg.match(/linear-gradient\((.*)\)$/); if (!m) return null;
    const parts = splitTop(m[1]);
    let angle = 180;
    const first = parts[0].replace(/\s+in\s+\w+/, '').trim();
    const dirs = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270, 'to right top': 45, 'to top right': 45,
      'to right bottom': 135, 'to bottom right': 135, 'to left bottom': 225, 'to bottom left': 225, 'to left top': 315, 'to top left': 315 };
    if (/deg$/.test(first)) { angle = parseFloat(first); parts.shift(); }
    else if (first in dirs) { angle = dirs[first]; parts.shift(); }
    else if (/^in\s/.test(parts[0])) parts.shift();
    const stops = parts.map((p, i) => {
      const pm = p.match(/\s(-?[\d.]+)%$/);
      const col = pm ? p.slice(0, pm.index) : p;
      return [cid(col), pm ? parseFloat(pm[1]) / 100 : i / Math.max(1, parts.length - 1)];
    }).filter(s => s[0]);
    return stops.length >= 2 ? { lg: { a: angle, s: stops } } : null;
  }
  function radius(cs, rect) {
    const max = rect ? Math.min(rect.width, rect.height) / 2 : Infinity;
    const r = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomRightRadius', 'borderBottomLeftRadius']
      .map(k => R(Math.min(max, parseFloat(cs[k]) || 0)));
    if (r.every(v => v === 0)) return null;
    return r.every(v => v === r[0]) ? r[0] : r;
  }
  function border(cs) {
    const sides = ['Top', 'Right', 'Bottom', 'Left'];
    const w = sides.map(s => (cs['border' + s + 'Style'] !== 'none' ? parseFloat(cs['border' + s + 'Width']) : 0) || 0);
    if (w.every(v => v === 0)) return null;
    const i = w.findIndex(v => v > 0);
    const c = cid(cs['border' + sides[i] + 'Color']);
    if (!c) return null;
    return { c, w: w.every(v => v === w[0]) ? w[0] : w };
  }

  function visuals(el, cs) {
    const v = {};
    const bg = cid(cs.backgroundColor);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') {
      const g = gradient(cs.backgroundImage); // url() backgrounds are ignored
      if (g) v.fill = g;
    }
    if (!v.fill && bg) v.fill = bg;
    const b = border(cs); if (b) v.bd = b;
    let sh = shadows(cs);
    // tailwind ring: "0 0 0 1px inset" → treat as border if no real border
    if (sh) {
      const ringIdx = sh.findIndex(s => s[1] === 0 && s[2] === 0 && s[3] === 0 && s[4] > 0);
      if (ringIdx >= 0 && !v.bd) { const s = sh[ringIdx]; v.bd = { c: s[0], w: s[4], ...(s[5] ? {} : { out: 1 }) }; sh.splice(ringIdx, 1); }
      if (sh.length) v.sh = sh;
    }
    const hasPaint = v.fill || v.bd || v.sh;
    if (hasPaint) { const r = radius(cs, el.getBoundingClientRect ? el.getBoundingClientRect() : null); if (r) v.r = r; }
    const op = parseFloat(cs.opacity); if (op < 1) v.op = Math.round(op * 100) / 100;
    return v;
  }

  function hidden(el, cs) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    if (parseFloat(cs.opacity) === 0) return true;
    if (el.getAttribute('aria-hidden') === 'true' && el.tagName !== 'svg' && !el.querySelector('svg,img')) {
      const r = el.getBoundingClientRect(); if (r.width < 2 && r.height < 2) return true;
    }
    return false;
  }

  const INLINE_TAGS = /^(SPAN|B|STRONG|I|EM|U|S|SMALL|MARK|SUB|SUP|CODE|ABBR|TIME|LABEL|A|BR|WBR|Q|CITE|KBD|DEL|INS)$/;
  // Element whose content is only text + plain inline elements (no own paint) → one TEXT node.
  function pureInline(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3) continue;
      if (n.nodeType !== 1) continue;
      const cs = getComputedStyle(n);
      if (cs.display === 'none') continue;
      if (n.tagName === 'BR') continue;
      if (!INLINE_TAGS.test(n.tagName)) return false;
      if (!cs.display.startsWith('inline') || cs.display !== 'inline') return false;
      const v = visuals(n, cs); if (v.fill || v.bd || v.sh) return false;
      if (!pureInline(n)) return false;
    }
    return true;
  }
  const hasText = el => /\S/.test(el.textContent);

  // Build characters + styled segments from an inline subtree.
  function collectText(root) {
    const pieces = [];
    (function walk(node, styleEl) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) pieces.push({ s: n.data, el: styleEl });
        else if (n.nodeType === 1) {
          if (n.tagName === 'BR') { pieces.push({ s: '\n', el: styleEl, br: 1 }); continue; }
          if (getComputedStyle(n).display === 'none') continue;
          walk(n, n);
        }
      }
    })(root, root);
    let out = '';
    const segs = [];
    for (const p of pieces) {
      const cs = getComputedStyle(p.el);
      const pre = /^pre/.test(cs.whiteSpace);
      let s = p.s;
      if (!p.br && !pre) s = s.replace(/[\s ]+/g, m => (m.includes(' ') ? ' ' : ' '));
      if (cs.textTransform === 'uppercase') s = s.toUpperCase();
      else if (cs.textTransform === 'lowercase') s = s.toLowerCase();
      const start = out.length;
      for (const ch of s) {
        if (ch === ' ' && (out === '' || out.endsWith(' ') || out.endsWith('\n'))) continue;
        if (ch === '\n' && out.endsWith(' ')) out = out.slice(0, -1);
        out += ch;
      }
      if (out.length > start) segs.push({ start, end: out.length, st: sid(cs), c: cid(cs.color) });
    }
    const trimmed = out.replace(/\s+$/, '');
    const segsT = segs.map(s => ({ ...s, end: Math.min(s.end, trimmed.length) })).filter(s => s.end > s.start);
    return { text: trimmed, segs: segsT };
  }


  // Figma sizes text boxes by line-height, browsers report glyph boxes → convert.
  function textBox(range, cs, fallback) {
    const rects = [...range.getClientRects()].filter(r => r.width > 0);
    const r = rects.length ? range.getBoundingClientRect() : fallback;
    const fs = parseFloat(cs.fontSize);
    const lh = parseFloat(cs.lineHeight) || fs * 1.2;
    const tops = [];
    for (const q of rects) if (!tops.some(t => Math.abs(t - q.top) < lh / 2)) tops.push(q.top);
    const lines = Math.max(1, tops.length);
    const glyphH = rects.length ? rects[0].height : r.height;
    const top = r.top - (lh - glyphH) / 2;
    return { b: { ax: R(r.left + SX), ay: R(top + SY), w: Math.ceil(r.width), h: R(lines * lh) }, lines };
  }

  function textNode(el, cs, rect) {
    const { text, segs } = collectText(el);
    if (!text) return null;
    const range = document.createRange(); range.selectNodeContents(el);
    const { b, lines } = textBox(range, cs, rect);
    const st = sid(cs), c = cid(cs.color);
    const node = { t: 'text', n: text.slice(0, 40), ...b, tx: text, st, c };
    if (lines > 1 || text.includes('\n')) node.wrap = 1;
    const al = { center: 'CENTER', right: 'RIGHT', end: 'RIGHT', justify: 'JUSTIFIED' }[cs.textAlign];
    if (al && node.wrap) node.al = al;
    const diff = segs.filter(s => s.st !== st || s.c !== c)
      .map(s => [s.start, s.end, ...(s.st !== st ? [s.st] : [0]), ...(s.c !== c ? [s.c] : [])]);
    if (diff.length) node.seg = diff;
    const op = parseFloat(cs.opacity); if (op < 1) node.op = Math.round(op * 100) / 100;
    return node;
  }

  function textFromTextNode(tn, parentEl) {
    const cs = getComputedStyle(parentEl);
    let s = tn.data.replace(/[\s]+/g, ' ').trim();
    if (!s) return null;
    if (cs.textTransform === 'uppercase') s = s.toUpperCase();
    const range = document.createRange(); range.selectNodeContents(tn);
    if (range.getBoundingClientRect().width < 1) return null;
    const { b, lines } = textBox(range, cs, null);
    const node = { t: 'text', n: s.slice(0, 40), ...b, tx: s, st: sid(cs), c: cid(cs.color) };
    if (lines > 1) node.wrap = 1;
    return node;
  }


  function nameOf(el) {
    const tag = el.tagName.toLowerCase();
    const label = el.getAttribute('aria-label') || el.id || '';
    const sem = /^(header|nav|main|section|footer|aside|article|button|a|ul|ol|li|form|input|table|thead|tbody|tr|td|th|label|h[1-6]|p)$/.test(tag) ? tag : 'div';
    const t = (el.innerText || '').trim().split('\n')[0].slice(0, 24);
    return [sem === 'a' ? 'link' : sem, label || t].filter(Boolean).join(' · ');
  }

  // ---------- walk ----------
  function walk(el) {
    if (el.nodeType !== 1) return [];
    const tag = el.tagName;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|HEAD)$/.test(tag)) return [];
    const cs = getComputedStyle(el);
    if (hidden(el, cs)) return [];
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 && rect.height <= 1 && cs.overflow !== 'visible') return [];
    // Only HTML/CSS boxes are transferred — media and vector assets are skipped by design.
    if (/^(svg|IMG|VIDEO|CANVAS|PICTURE|IFRAME|OBJECT|EMBED)$/.test(tag)) return [];
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      const v = visuals(el, cs);
      const node = { t: 'frame', n: tag.toLowerCase(), ...box(rect), ...v, ch: [] };
      const val = el.value || el.placeholder || '';
      if (val && el.type !== 'checkbox' && el.type !== 'radio') {
        const pcs = el.value ? cs : getComputedStyle(el, '::placeholder');
        const pl = parseFloat(cs.paddingLeft) || 0;
        const fs = parseFloat(cs.fontSize);
        const lh = parseFloat(cs.lineHeight) || fs * 1.2;
        node.ch.push({ t: 'text', n: val.slice(0, 40), ax: node.ax + pl + (parseFloat(cs.borderLeftWidth) || 0), ay: R(node.ay + (rect.height - lh) / 2), w: R(rect.width - pl * 2), h: R(lh), tx: val, st: sid(cs), c: cid(pcs.color) || cid(cs.color) });
      }
      return [node];
    }

    const v = visuals(el, cs);
    const paints = !!(v.fill || v.bd || v.sh);
    const clip = (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1 || !!radius(cs));

    // Pure text element
    if (hasText(el) && pureInline(el)) {
      const t = textNode(el, cs, rect);
      if (!t) return [];
      if (!paints && !clip) { if (v.op) t.op = v.op; return [t]; }
      return [{ t: 'frame', n: nameOf(el), ...box(rect), ...v, ...(clip ? { clip: 1 } : {}), ch: [t] }];
    }

    let ch = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3) { const t = textFromTextNode(n, el); if (t) ch.push(t); }
      else ch.push(...walk(n));
    }
    // ::before / ::after with paint (dots, bars)
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      if (ps.content && ps.content !== 'none' && ps.display !== 'none') {
        const pv = visuals(el, ps);
        const w = parseFloat(ps.width), h = parseFloat(ps.height);
        if ((pv.fill || pv.bd) && w > 0 && h > 0 && ps.position === 'absolute') {
          const left = parseFloat(ps.left), top = parseFloat(ps.top);
          if (!isNaN(left) && !isNaN(top)) ch.push({ t: 'frame', n: pseudo.slice(2), ax: R(rect.left + SX + left), ay: R(rect.top + SY + top), w: R(w), h: R(h), ...pv });
        }
      }
    }

    if (!paints && !clip && !v.op) {
      if (ch.length === 0) return [];
      if (ch.length === 1) return ch; // collapse wrapper
    }
    if (ch.length === 0 && !paints) return [];
    const node = { t: 'frame', n: nameOf(el), ...box(rect), ...v, ...(clip ? { clip: 1 } : {}) };
    if (rect.width < 1 || rect.height < 1) {
      // zero-size wrapper (e.g. absolute children): use union of children
      const xs = ch.map(c => c.ax), ys = ch.map(c => c.ay);
      node.ax = Math.min(...xs); node.ay = Math.min(...ys);
      node.w = Math.max(...ch.map(c => c.ax + c.w)) - node.ax; node.h = Math.max(...ch.map(c => c.ay + c.h)) - node.ay;
    }
    node._dir = cs.display.includes('flex') && cs.flexDirection.startsWith('row') ? 'H' : 'V';
    node.ch = ch;
    return [node];
  }

  // ---------- layout inference: auto layout only where it reproduces geometry exactly ----------
  function tryLayout(node, dir) {
    const kids = node.ch;
    const P = dir === 'H' ? ['x', 'w'] : ['y', 'h'];
    const Q = dir === 'H' ? ['y', 'h'] : ['x', 'w'];
    const sorted = [...kids].sort((a, b) => a[P[0]] - b[P[0]]);
    for (const k of sorted) if (k[P[0]] < 0 || k[Q[0]] < 0 || k[P[0]] + k[P[1]] > node[P[1]] + 1 || k[Q[0]] + k[Q[1]] > node[Q[1]] + 1) return null;
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i][P[0]] - (sorted[i - 1][P[0]] + sorted[i - 1][P[1]]);
      if (g < 0) return null;
      gaps.push(g);
    }
    if (gaps.length && Math.max(...gaps) - Math.min(...gaps) > 1) return null;
    const gap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
    const S = node[Q[1]];
    const starts = sorted.map(k => k[Q[0]]);
    const ends = sorted.map(k => S - (k[Q[0]] + k[Q[1]]));
    const centers = sorted.map(k => k[Q[0]] + k[Q[1]] / 2);
    const maxQ = Math.max(...sorted.map(k => k[Q[1]]));
    const same = arr => Math.max(...arr) - Math.min(...arr) <= 1;
    let a, cs0, ce0;
    if (sorted.length === 1 || same(starts)) {
      a = 'MIN'; cs0 = Math.min(...starts); ce0 = Math.max(0, S - cs0 - maxQ);
      if (sorted.length === 1 && Math.abs(centers[0] - S / 2) <= 1 && starts[0] > 0) { a = 'CENTER'; cs0 = 0; ce0 = 0; }
    } else if (same(centers)) {
      a = 'CENTER'; const cc = centers[0]; cs0 = Math.max(0, R(2 * cc - S)); ce0 = Math.max(0, R(S - 2 * cc));
    } else if (same(ends)) {
      a = 'MAX'; ce0 = Math.min(...ends); cs0 = Math.max(0, S - ce0 - maxQ);
    } else return null;
    const ps = sorted[0][P[0]], pe = node[P[1]] - (sorted[sorted.length - 1][P[0]] + sorted[sorted.length - 1][P[1]]);
    node.ch = sorted;
    const p = dir === 'H' ? [cs0, pe, ce0, ps] : [ps, ce0, pe, cs0];
    return { d: dir, g: gap, p: p.map(v => Math.max(0, R(v))), a }; // Figma rejects negative padding
  }

  function finalize(node, px, py) {
    node.x = node.ax - px; node.y = node.ay - py;
    if (node.ch) {
      for (const c of node.ch) finalize(c, node.ax, node.ay);
      if (node.ch.length) {
        const pref = node._dir || 'V';
        const lay = tryLayout(node, pref) || tryLayout(node, pref === 'H' ? 'V' : 'H');
        if (lay) {
          node.lay = lay;
          if (lay.p.every(v => v === 0)) delete lay.p;
          if (!lay.g) delete lay.g;
          if (lay.a === 'MIN') delete lay.a;
          for (const c of node.ch) { delete c.x; delete c.y; }
        }
      } else delete node.ch;
    }
    delete node.ax; delete node.ay; delete node._dir;
    // key order for readability
    const { t, n, x, y, w, h, ...rest } = node;
    for (const k of Object.keys(node)) delete node[k];
    Object.assign(node, { t, n, ...(x !== undefined ? { x, y } : {}), w, h, ...rest });
  }

  window.scrollTo(0, 0);
  const html = getComputedStyle(document.documentElement), body = getComputedStyle(document.body);
  const pageBg = cid(body.backgroundColor) || cid(html.backgroundColor) || cid('#ffffff');
  const W = document.documentElement.clientWidth, H = document.documentElement.scrollHeight;
  const children = [];
  for (const n of document.body.childNodes) children.push(...(n.nodeType === 1 ? walk(n) : []));
  const root = { t: 'frame', n: document.title || location.hostname, ax: 0, ay: 0, w: W, h: H, fill: pageBg, ch: children, _dir: 'V' };
  // unwrap single full-width wrappers so sections become root children
  while (root.ch.length === 1 && root.ch[0].t === 'frame' && root.ch[0].ch && root.ch[0].w >= W - 1 && !root.ch[0].bd && !root.ch[0].sh) {
    const only = root.ch[0];
    if (only.fill && typeof only.fill === 'string' && only.fill !== root.fill) break;
    root.ch = only.ch; root._dir = only._dir;
  }
  finalize(root, 0, 0);
  delete root.x; delete root.y;

  return JSON.stringify({
    v: 1,
    meta: { url: location.href, title: document.title, viewport: { w: window.innerWidth, h: window.innerHeight }, page: { w: W, h: H }, at: new Date().toISOString() },
    tokens: { colors, text: textStyles },
    root,
  });
})()

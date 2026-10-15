// web-to-figma expand — runs inside the page before extract.js.
// App-style layouts keep the document at viewport height and scroll an inner container, so a
// plain window scroll never reveals the rest. This walks every scroll container to its end
// (triggering lazy/infinite loading), then lifts the height limits on those containers and their
// fixed-height ancestors so the whole content lays out as one tall page. Inline styles it touches
// are recorded; window.__w2fRestore() puts them back after extraction.
// Returns a JSON string summary.
(async () => {
  const MAX_SCROLL = 30000; // px per container — stops infinite feeds from running forever
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const vh = window.innerHeight;
  const before = document.documentElement.scrollHeight;

  const scrollable = el => {
    const cs = getComputedStyle(el);
    return /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.clientHeight >= 120;
  };
  const containers = [document.scrollingElement, ...[...document.querySelectorAll('body *')].filter(scrollable)];

  // 1) walk each container to the bottom so lazily rendered content mounts
  for (const el of containers) {
    for (let y = 0, i = 0; y < Math.min(el.scrollHeight, MAX_SCROLL) && i < 80; y += Math.max(200, el.clientHeight * 0.8), i++) {
      el.scrollTop = y;
      await sleep(120);
    }
    el.scrollTop = 0;
  }
  window.scrollTo(0, 0);
  await sleep(300);

  // 2) lift height limits: inner containers + every ancestor up to <html>
  const saved = [];
  const touched = new Set();
  // Every ancestor is unlocked unconditionally: with flex-1/min-h-0 layouts the limit usually sits
  // on a parent (e.g. a h-screen sidebar), and computed heights can't tell "fixed" from "auto".
  // min-height keeps each box at least its current size so nothing collapses.
  const unlock = el => {
    if (touched.has(el)) return;
    touched.add(el);
    const h = el.getBoundingClientRect().height;
    saved.push([el, el.style.cssText]);
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('overflow-y', 'visible', 'important');
    el.style.setProperty('min-height', h + 'px', 'important');
    // fixed/absolute boxes pinned with top+bottom (e.g. inset-y-0 sidebars) take their height from
    // the insets, not from `height` — release the bottom edge so content can grow
    const cs = getComputedStyle(el);
    if ((cs.position === 'fixed' || cs.position === 'absolute') && cs.top !== 'auto' && cs.bottom !== 'auto') el.style.setProperty('bottom', 'auto', 'important');
  };
  const inner = containers.filter(el => el !== document.scrollingElement);
  for (const el of inner) {
    for (let n = el; n && n !== document; n = n.parentElement) unlock(n);
  }
  if (inner.length) { unlock(document.documentElement); unlock(document.body); }
  await sleep(300);

  window.__w2fRestore = () => { for (const [el, css] of saved.reverse()) el.style.cssText = css; delete window.__w2fRestore; };
  return JSON.stringify({ scrollContainers: inner.length, unlocked: saved.length, viewport: vh, heightBefore: before, heightAfter: document.documentElement.scrollHeight });
})()

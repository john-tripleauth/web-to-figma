# page.json

`scripts/extract.js` output — the rendered page expressed in Figma terms, not DOM terms.
Wrapper elements without paint are collapsed; sizes are integers in CSS px.

```jsonc
{
  "v": 1,
  "meta": { "url", "title", "viewport": { "w", "h" }, "page": { "w", "h" }, "at" },
  "tokens": {
    "colors": { "c1": "#ffffff", "c2": "#ffffffd9" },           // #rrggbb[aa], sRGB
    "text":   { "t1": { "fs": 15, "fw": 700, "lh": 22.5, "ls": -0.37, "it": 1 } }
  },                                                            // lh null = normal
  "root": Node
}
```

## Node

| key | meaning |
|---|---|
| `t` | `frame` or `text` |
| `n` | layer name (`<tag> · <first text>`) |
| `x`, `y` | position in parent — **omitted when the parent has `lay`** |
| `w`, `h` | size |
| `ch` | children, in visual order |

**frame**

| key | meaning |
|---|---|
| `fill` | color id, or `{ "lg": { "a": deg, "s": [[colorId, 0..1], …] } }` (CSS linear-gradient angle) |
| `bd` | border `{ c: colorId, w: n \| [t,r,b,l], out?: 1 }` (`out` = outside stroke, from box-shadow rings) |
| `r` | radius `n` or `[tl,tr,br,bl]` |
| `sh` | shadows `[[colorId, x, y, blur, spread, inset?], …]` |
| `op` | opacity |
| `clip` | 1 = clips content |
| `lay` | Auto Layout `{ d: "H"\|"V", g?: gap, p?: [t,r,b,l], a?: "CENTER"\|"MAX" }` — only emitted when it reproduces the measured geometry exactly; otherwise children keep `x/y` |

**text**

| key | meaning |
|---|---|
| `tx` | characters |
| `st` | text style id |
| `c` | color id |
| `seg` | styled ranges `[[start, end, styleId \| 0, colorId?], …]` |
| `wrap` | 1 = fixed width, wraps (otherwise auto width) |
| `al` | `CENTER` \| `RIGHT` \| `JUSTIFIED` (wrapping text only) |

Text boxes use line-height based height (as Figma does), not the browser's glyph box.

## In Figma

- colors → Variables collection `web-to-figma colors`, named `color/<hex>`
- text tokens → local text styles `text/<size> <weight> · <line-height>`
- root frame → `<title> [<run id>]`; redrawing the same run replaces it

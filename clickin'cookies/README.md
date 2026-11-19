# Cookie Clicker — Offline Clone

A thorough, fully offline re-creation of the core Cookie Clicker experience.
**Zero external requests**: no CDNs, no fonts, no images — everything (including all
sprites) is plain HTML/CSS/JS, so it runs from a `file://` double-click forever,
even with the network cable unplugged.

## Run it

1. Double-click **`index.html`** (or open it in any modern browser).
2. That's it. Progress auto-saves to `localStorage` every 15 seconds and on tab close.

No server, no build step, no dependencies. To reset everything: use the
**Hard reset** button (bottom-right), which asks for confirmation twice.

## File map

```
index.html          Page structure (3-panel layout) + script includes
css/style.css       Entire visual theme + ALL placeholder sprite art
js/data.js          Buildings, upgrades, heavenly shop, achievements, news text
js/format.js        Number formatting (1.23K / 4.56M / …), time formatting
js/game.js          Core engine — no DOM access; safe to run headless
js/ui.js            All DOM rendering, events, effects, autosave
assets/             Drop your own images here (see below)
test/smoke.js       Headless Node smoke test for the engine
test/e2e.js         Optional E2E test: drives the real page in headless Chrome
```

## What's implemented

| Feature | Details |
|---|---|
| Big cookie | Clicking with floating `+N` numbers, crumb particles, squish animation |
| Milk pool backdrop | Animated milk wave + 4 bobbing cookies behind the big cookie (pure CSS) |
| Cursor army | One little cursor per Cursor owned (up to 12) pokes the big cookie; periodic `+CpS` floats show auto-production |
| Resizable store | Drag the divider left of the store to shrink/grow it (320–900 px); width persists in `cookieClickerClone.ui.v1` |
| Achievement hints | Hovering any achievement shows exactly how to unlock it (mystery text while locked) |
| 14 buildings | Cursor → Prism, price scaling ×1.15 per unit owned, x1 / x10 bulk buy |
| ~100 upgrades | 6 doubling tiers per building (unlock at 1/5/25/50/100/200 owned) + mid-game global (×1.5), click, golden and offline-cap upgrades + 7 two-building synergy doubles, tooltips, affordable badge on the tab |
| Golden cookies | Spawn every 45–120 s (upgradeable), 13 s to click; **Frenzy** (×7 for 18 s) or **Lucky** (+600 s of CpS, min 13) |
| Buff banner | Live countdown with progress bar under the cookie counter |
| Achievements | 32 achievements (bakes, CpS, buildings, clicks, goldens, frenzies, playtime, ascensions), +2% production each, toast notifications, right-panel grid |
| Ascension | Heavenly chips = `floor((runBaked / 1e9)^0.4)`; +2% production per chip, permanent |
| Heavenly shop | 4 one-time chip purchases (click power, global ×1.25, golden frequency, offline bonus) |
| Offline earnings | Full CpS while away, capped at 8 h (14 h via the Night shift ovens upgrade; 30 h & ×2 with the right heavenly upgrade); welcome-back modal |
| News ticker | Rotating flavor headlines with live CpS/cookie counts |
| Stats panel | Bank, CpS, click power, run/all-time baked, clicks, goldens, playtime, chips, bonuses |
| Save system | `localStorage` keys `cookieClickerClone.save.v1` (game) + `cookieClickerClone.ui.v1` (panel width); autosave 15 s + on unload/hide; manual save & hard reset |
| Engine clock | Timestamped ticks in the UI loop — throttled/background tabs accrue exact time, nothing is lost |

## Mechanics notes (formulas)

- **CpS** = Σ(units × unitCps × building multipliers) × global multiplier × frenzy
- **Global multiplier** = (1 + 2%·chips) × (1 + 2%·achievements) × Π(all-output upgrades)
- **Click power** = (1 + base adds) × Π(click multipliers) + CpS × Σ(CpS-% click upgrades)
- **Building price of the nth unit** = `ceil(baseCost × 1.15^owned)`

These approximate the original game's systems; tuning constants live in
`CC_DATA.TUNING` at the bottom of `js/data.js` if you want to tweak them.

## Replacing the placeholder sprites

Every sprite is CSS-drawn on a small, well-named element so you can swap art
without touching any logic:

| What | Selector (in `css/style.css`) | Element in HTML |
|---|---|---|
| Big cookie | `.cookie-art` | inside `#big-cookie` |
| Golden cookie | `.golden-art` | inside `#golden` |
| Cursor | `.sprite--cursor .art` | building rows + upgrade tiles |
| Grandma | `.sprite--grandma .art` | … |
| Farm | `.sprite--farm .art` | … |
| Mine | `.sprite--mine .art` | … |
| Factory | `.sprite--factory .art` | … |
| Bank | `.sprite--bank .art` (+ `::after` columns) | … |
| Temple | `.sprite--temple .art` (+ `::after`) | … |
| Wizard tower | `.sprite--wizard .art` (+ `::after` window) | … |
| Shipment | `.sprite--shipment .art` (+ `::after`) | … |
| Alchemy lab | `.sprite--alchemy .art` (+ `::after` bubbles) | … |
| Portal | `.sprite--portal .art` | … |
| Time machine | `.sprite--timemachine .art` (+ `::before/::after` hands) | … |
| Antimatter condenser | `.sprite--antimatter .art` | … |
| Prism | `.sprite--prism .art` | … |
| Star icon (click upgrades) | `.icon-star .art` | upgrade tiles |
| Milk pool backdrop | `#milk` (+ `.wave`) | behind the big cookie, bottom of left panel |
| Bobbing cookies in milk | `.floaty-cookie.fc1…fc4` | inside `#milk` |
| Little army cursors | `.mini-cursor` | inside `#clicker-army`, around the big cookie |
| Golden icon (golden upgrades) | `.icon-golden .art` | upgrade tiles |
| Chip icon (heavenly shop) | `.icon-chip .art` | heavenly rows |

### Recommended swap pattern

1. Put your images in `assets/` (e.g. `assets/cursor.png`, `assets/cookie.jpg`).
2. Create **`assets/custom.css`** and add it to `<head>` *after* `style.css`:

   ```html
   <link rel="stylesheet" href="css/style.css">
   <link rel="stylesheet" href="assets/custom.css">
   ```

3. In `assets/custom.css`, override each sprite you have art for:

   ```css
   /* Real cookie replaces the CSS-drawn one */
   .cookie-art {
     background: url('assets/cookie.png') center / contain no-repeat;
     box-shadow: none;              /* drop placeholder shading if unwanted */
   }
   .golden-art {
     border-radius: 0;
     background: url('assets/golden.png') center / contain no-repeat;
     box-shadow: 0 0 22px rgba(255, 210, 74, .85); /* keep the glow */
   }

   /* Building icons — .art sits in a 50×50 tile with padding, so use contain */
   .sprite--cursor .art    { background: url('assets/cursor.png') center / contain no-repeat; clip-path: none; filter: none; }
   .sprite--grandma .art   { background: url('assets/grandma.png') center / contain no-repeat; border-radius: 0; }

   /* Bank/temple/etc. draw details with ::after — silence it if your image has them */
   .sprite--bank .art::after,
   .sprite--temple .art::after { content: none; }
   ```

Because `custom.css` loads last, plain overrides win without editing the main
stylesheet at all. The `.sprite` tile (dark rounded square) stays as a backdrop —
set `.sprite { background: transparent; border-color: ...; }` if you prefer your
images to float freely.

> Tip: PNGs with transparency look best for building icons; the big cookie and
> golden cookie work great as squares or circles alike since `background-size:
> contain` handles any aspect ratio.

## Testing (optional)

The engine has no DOM dependency, so you can smoke-test it headlessly:

```bash
node test/smoke.js        # pure-logic engine tests (Node only)
node test/e2e.js          # optional: drives the real page in headless Chrome via CDP (Node >= 22)
```

The smoke test exercises clicks, purchases, cost scaling, upgrades, golden
cookies, tick accrual, save/load round-trips, offline earnings, and ascension.
The E2E test boots `index.html` in real Chrome and verifies the UI: rendering,
clicking through the DOM, store/upgrade/tab interactions, toasts, and saves.

## Privacy / safety notes

- All state stays in your browser's `localStorage` for the page origin.
  (For `file://` URLs that means per-browser, per-machine — no account, no cloud.)
- No analytics, no network calls, nothing leaves your machine.

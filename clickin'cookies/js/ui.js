/* =====================================================================
 * Cookie Clicker clone — UI layer (DOM). All game logic lives in CC.
 * Expects data.js + format.js + game.js to be loaded first.
 * ===================================================================*/
(function () {
  'use strict';

  if (typeof document === 'undefined') return; // headless guard

  const D = window.CC_DATA, T = D.TUNING, F = window.CC_FMT, CC = window.CC;
  const $ = function (id) { return document.getElementById(id); };

  let buyQty = 1;            // x1 / x10 toggle
  let activeTab = 'buildings';
  const bRows = {};          // buildingId -> row DOM refs
  const uTiles = {};         // upgradeId  -> tile DOM ref
  const hRows = {};          // hUpgradeId -> row DOM refs
  const aItems = {};         // achievementId -> li ref
  let lastGoldenRef = null;  // to detect spawn transitions
  let tipVisibleId = null;   // upgrade id currently shown in the tooltip (null when hidden)
  const lastMouse = { x: 0, y: 0 }; // last pointer position over a tooltip host (viewport coords)

  /* ---------------- small helpers ------------------------------------ */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function toast(kind, text) {
    const box = $('toasts');
    if (box.children.length > 5) box.removeChild(box.firstChild);
    const t = el('div', 'toast ' + kind, text);
    box.appendChild(t);
    setTimeout(function () { t.classList.add('out'); }, 3800);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 4400);
  }

  /* ---------------- build: building list ------------------------------ */
  function buildBuildingList() {
    const ul = $('building-list');
    D.BUILDINGS.forEach(function (b) {
      const li = el('li', 'b-row');
      li.dataset.id = b.id;

      const sprite = el('span', 'sprite sprite--' + b.id);
      sprite.appendChild(el('i', 'art'));

      const info = el('div', 'b-info');
      info.appendChild(el('div', 'b-name', b.name));
      info.appendChild(el('div', 'b-cost'));
      info.appendChild(el('div', 'b-cps muted'));

      const owned = el('div', 'b-owned', '0');

      li.appendChild(sprite); li.appendChild(info); li.appendChild(owned);
      li.addEventListener('click', function () {
        if (CC.buyBuilding(b.id, buyQty)) flashRow(li);
      });
      ul.appendChild(li);
      bRows[b.id] = { li: li, cost: info.children[1], cpsLine: info.children[2], owned: owned };
    });
  }

  function flashRow(row) { row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash'); }

  /* ---------------- build: upgrade grid -------------------------------- */
  // Icon class for global (non-building) upgrades.
  const GLOBAL_ICONS = { click_1: 'star', click_2: 'star', click_3: 'star', click_4: 'star', click_5: 'star', click_6: 'star', all_1: 'prism', all_2: 'prism', all_3: 'prism', gc_1: 'golden', gc_2: 'golden', lucky_1: 'star', offline_1: 'star' };

  function buildUpgradeGrid() {
    const grid = $('upgrade-grid');
    D.UPGRADES.forEach(function (u) {
      const tile = el('button', 'upg-tile hidden', null);
      tile.type = 'button';
      tile.dataset.id = u.id;

      let iconCls;
      if (u.effect && u.effect.building) iconCls = 'sprite--' + u.effect.building;
      else if (u.effect && Array.isArray(u.effect.buildings)) iconCls = 'sprite--' + u.effect.buildings[0]; // synergy tiles use the first building's art
      else { const g = GLOBAL_ICONS[u.id] || 'star'; iconCls = g === 'golden' ? 'icon-golden' : 'icon-' + g; }

      const sprite = el('span', 'sprite ' + iconCls);
      sprite.appendChild(el('i', 'art'));
      tile.appendChild(sprite);
      grid.appendChild(tile);
      uTiles[u.id] = tile;
    });

    // Tooltip via delegation. lastMouse/tipVisibleId let refreshStore()
    // re-target the tooltip after a purchase reflows the grid under a
    // stationary cursor (otherwise its description goes stale).
    grid.addEventListener('mousemove', function (e) {
      lastMouse.x = e.clientX; lastMouse.y = e.clientY;
      const tile = e.target.closest('.upg-tile');
      if (!tile || tile.classList.contains('hidden')) { hideTip(); return; }
      showTip(tile.dataset.id, e.clientX, e.clientY);
    });
    grid.addEventListener('mouseleave', hideTip);

    grid.addEventListener('click', function (e) {
      const tile = e.target.closest('.upg-tile');
      if (!tile || tile.classList.contains('hidden')) return;
      if (CC.buyUpgrade(tile.dataset.id)) flashRow(tile);
    });
  }

  // Achievements: instant styled tooltips with unlock hints (locked too).
  const achList = $('achievement-list');
  if (achList) {
    achList.addEventListener('mousemove', function (e) {
      const li = e.target.closest('.ach-item');
      if (!li) { hideTip(); return; }
      showAchTip(li.dataset.id, e.clientX, e.clientY);
    });
    achList.addEventListener('mouseleave', hideTip);
  }

  const tipEl = $('tooltip');
  function showTip(id, x, y) {
    const u = CC.upgradeById(id);
    if (!u) return;
    tipVisibleId = id;
    const visible = CC.upgradeVisible(u);
    let html = '<div class="tip-name">' + u.name + '</div>' +
               '<div class="tip-cost">Cost: ' + F.int(u.cost) + ' cookies</div>' +
               '<div class="tip-desc">' + u.desc + '</div>';
    if (!visible && !CC.upgradeReqMet(u)) html += '<div class="tip-req">' + reqText(u.req) + '</div>';
    tipEl.innerHTML = html;
    tipEl.classList.remove('hidden');
    const r = tipEl.getBoundingClientRect();
    let left = Math.min(x + 14, window.innerWidth - r.width - 8);
    let top = Math.min(y + 16, window.innerHeight - r.height - 8);
    tipEl.style.left = Math.max(4, left) + 'px';
    tipEl.style.top = Math.max(4, top) + 'px';
  }
  function hideTip() { tipEl.classList.add('hidden'); tipVisibleId = null; }

  // Re-point the tooltip at whatever tile is actually under the last mouse
  // position. Called after a visibility change reflows the grid while the
  // cursor sits still (e.g. right after buying an upgrade) — fixes stale tips.
  function retargetTooltip() {
    if (!tipVisibleId) return; // only fix stale tips, never spawn new ones
    const under = document.elementFromPoint(lastMouse.x, lastMouse.y);
    const tile = under ? under.closest('.upg-tile') : null;
    if (tile && !tile.classList.contains('hidden')) showTip(tile.dataset.id, lastMouse.x, lastMouse.y);
    else hideTip();
  }

  // Styled, instant tooltip for achievements — works for locked ones too.
  function showAchTip(id, x, y) {
    const a = D.ACHIEVEMENTS.find(function (z) { return z.id === id; });
    if (!a) return;
    const unlocked = CC.S.achievements.indexOf(id) >= 0;
    let html = '<div class="tip-name">' + (unlocked ? '★ ' : '') + a.name + '</div>' +
               '<div class="tip-desc">' + a.desc + '</div>';
    html += unlocked
      ? '<div class="tip-req">How to unlock: ' + a.hint + '</div>'
      : '<div class="tip-req">??? — keep playing to reveal how to unlock this.</div>';
    tipEl.innerHTML = html;
    tipEl.classList.remove('hidden');
    const r = tipEl.getBoundingClientRect();
    // The list sits on the right — prefer opening toward the left.
    let left = x - r.width - 14;
    if (left < 8) left = Math.min(x + 14, window.innerWidth - r.width - 8);
    tipEl.style.left = Math.max(4, left) + 'px';
    tipEl.style.top = Math.max(4, Math.min(y + 16, window.innerHeight - r.height - 8)) + 'px';
  }

  function reqText(r) {
    if (!r) return '';
    const parts = [];
    if (r.building) { const b = CC.buildingById(r.building); parts.push('Requires ' + r.count + ' ' + b.name.toLowerCase() + (r.count > 1 ? 's' : '')); }
    if (Array.isArray(r.buildings)) {
      r.buildings.forEach(function (bb, i) {
        const b = CC.buildingById(bb.building);
        parts.push('Requires ' + bb.count + ' ' + b.name.toLowerCase() + (bb.count > 1 ? 's' : '') + (i < r.buildings.length - 1 ? ' AND' : ''));
      });
    }
    if (r.clicks) parts.push('Requires ' + F.int(r.clicks) + ' clicks');
    if (r.runBaked) parts.push('Requires baking ' + F.fmt(r.runBaked) + ' cookies this run');
    if (r.allBaked) parts.push('Requires baking ' + F.fmt(r.allBaked) + ' cookies total');
    if (r.goldenClicked) parts.push('Requires clicking ' + r.goldenClicked + ' golden cookies');
    if (r.totalBuildings) parts.push('Requires owning ' + r.totalBuildings + ' buildings');
    return parts.join('; ');
  }

  /* ---------------- build: heavenly panel ------------------------------ */
  function buildHeavenPanel() {
    const ul = $('h-upgrade-list');
    D.H_UPGRADES.forEach(function (h) {
      const li = el('li', 'h-row');
      li.dataset.id = h.id;

      const sprite = el('span', 'sprite icon-chip');
      sprite.appendChild(el('i', 'art'));

      const info = el('div', 'b-info');
      info.appendChild(el('div', 'b-name', h.name));
      info.appendChild(el('div', 'b-cost'));
      info.appendChild(el('div', 'b-cps muted', h.desc));

      const state = el('div', 'h-state', '');
      li.appendChild(sprite); li.appendChild(info); li.appendChild(state);
      li.addEventListener('click', function () {
        if (CC.buyHUpgrade(h.id)) flashRow(li);
      });
      ul.appendChild(li);
      hRows[h.id] = { li: li, cost: info.children[1], state: state };
    });
  }

  /* ---------------- build: stats + achievements ------------------------- */
  const STAT_DEFS = [
    ['st-cookies',     'Cookies in bank'],
    ['st-cps',         'Cookies per second'],
    ['st-power',       'Cookies per click'],
    ['st-run',         'Baked this run'],
    ['st-all',         'Baked all time'],
    ['st-clicks',      'Big cookie clicks'],
    ['st-golden',      'Golden cookies clicked'],
    ['st-frenzies',    'Frenzies experienced'],
    ['st-time',        'Time played'],
    ['st-chips',       'Heavenly chips'],
    ['st-achbonus',    'Achievement bonus'],
    ['st-ascensions',  'Ascensions']
  ];

  function buildStats() {
    const dl = $('stats-list');
    STAT_DEFS.forEach(function (d) {
      dl.appendChild(el('dt', null, d[1]));
      const dd = el('dd', null, '0');
      dd.id = d[0];
      dl.appendChild(dd);
    });
  }

  function buildAchievements() {
    const ul = $('achievement-list');
    D.ACHIEVEMENTS.forEach(function (a) {
      const li = el('li', 'ach-item locked');
      li.dataset.id = a.id;
      // Hover shows how to unlock it (mystery text while still hidden).
      li.title = '??? — keep playing to reveal this achievement.';
      li.textContent = a.name;
      ul.appendChild(li);
      aItems[a.id] = li;
    });
  }

  /* ---------------- refresh (4 Hz) -------------------------------------- */
  function refreshStore() {
    const S = CC.S;

    // Buildings
    D.BUILDINGS.forEach(function (b) {
      const r = bRows[b.id];
      const revealed = S.buildings[b.id] > 0 || S.allBaked >= b.baseCost * 0.4;
      r.li.classList.toggle('veiled', !revealed);

      if (!revealed) {
        r.cost.textContent = '?????';
        r.cpsLine.textContent = '???';
        r.owned.textContent = '';
        r.li.classList.add('cant');
        return;
      }
      const cost = CC.buildingCost(b.id, buyQty);
      r.cost.textContent = (buyQty > 1 ? 'x' + buyQty + ': ' : '') + F.int(cost) + ' cookies';
      const each = b.cps * buildingMultOf(b.id);
      r.cpsLine.textContent = '+' + F.fmt(each) + '/s each · +' + F.fmt(each * S.buildings[b.id]) + '/s total';
      r.owned.textContent = String(S.buildings[b.id]);
      r.li.classList.toggle('cant', S.cookies < cost);
    });

    // Upgrades: visibility, affordability, tab badge
    let affordableCount = 0;
    let upgVisChanged = false;
    D.UPGRADES.forEach(function (u) {
      const tile = uTiles[u.id];
      const visible = CC.upgradeVisible(u);
      const wasHidden = tile.classList.contains('hidden');
      tile.classList.toggle('hidden', !visible);
      if (wasHidden !== tile.classList.contains('hidden')) upgVisChanged = true;
      if (visible && S.cookies >= u.cost) { tile.classList.add('can'); affordableCount++; }
      else tile.classList.remove('can');
    });
    // A purchase just reflowed the grid under a possibly-stationary cursor.
    if (upgVisChanged) retargetTooltip();
    const badge = $('upg-badge');
    badge.textContent = String(affordableCount);
    badge.classList.toggle('hidden', affordableCount === 0 || activeTab !== 'buildings');

    // Heavenly panel
    $('chip-mini').textContent = S.chips > 0 ? F.int(S.chips) + ' ◆' : '';
    D.H_UPGRADES.forEach(function (h) {
      const r = hRows[h.id];
      const owned = S.hUpgrades.indexOf(h.id) >= 0;
      r.cost.textContent = owned ? '' : F.int(h.cost) + ' chips';
      r.state.textContent = owned ? 'OWNED' : '';
      r.li.classList.toggle('owned', owned);
      r.li.classList.toggle('cant', !owned && S.chips < h.cost);
    });

    const pot = CC.potentialChips();
    $('ascend-earn').textContent = 'You would earn ' + F.int(pot) + ' heavenly chip' + (pot === 1 ? '' : 's') + '.';
    $('btn-ascend').disabled = pot < 1;

    syncArmy();

    refreshStats();
    refreshAchievements();
  }

  function buildingMultOf(id) {
    // Re-expose the engine's per-building multiplier for display math.
    // Must stay in sync with CC's effectHitsBuilding (single + pair synergies).
    let m = 1;
    const S = CC.S;
    D.UPGRADES.forEach(function (u) {
      const hit = u.effect && (u.effect.building === id ||
        (Array.isArray(u.effect.buildings) && u.effect.buildings.indexOf(id) >= 0));
      if (hit && S.upgrades.indexOf(u.id) >= 0) m *= (u.effect.value || 2);
    });
    return m * globalAllOf();
  }

  function globalAllOf() {
    const S = CC.S;
    let m = (1 + T.CHIP_BONUS * S.chips) * (1 + T.ACHIEVEMENT_BONUS * S.achievements.length);
    D.UPGRADES.forEach(function (u) { if (u.effect && u.effect.allMult && S.upgrades.indexOf(u.id) >= 0) m *= u.effect.allMult; });
    D.H_UPGRADES.forEach(function (h) { if (h.effect && h.effect.allMult && S.hUpgrades.indexOf(h.id) >= 0) m *= h.effect.allMult; });
    return m * (CC.buffActive() ? CC.S.buff.mult : 1);
  }

  function refreshStats() {
    const S = CC.S;
    $('st-cookies').textContent = F.int(S.cookies);
    $('st-cps').textContent = F.fmt(CC.cps());
    $('st-power').textContent = F.fmt(CS_clickPowerSafe());
    $('st-run').textContent = F.fmt(S.runBaked);
    $('st-all').textContent = F.fmt(S.allBaked);
    $('st-clicks').textContent = F.int(S.stats.clicks);
    $('st-golden').textContent = F.int(S.stats.goldenClicked);
    $('st-frenzies').textContent = F.int(S.stats.frenzies);
    $('st-time').textContent = F.time(S.stats.playtimeMs);
    $('st-chips').textContent = F.int(S.chips) + '  (+' + (S.chips * T.CHIP_BONUS * 100).toFixed(0) + '%)';
    $('st-achbonus').textContent = '+' + (S.achievements.length * T.ACHIEVEMENT_BONUS * 100).toFixed(0) + '% (' + S.achievements.length + '/' + D.ACHIEVEMENTS.length + ')';
    $('st-ascensions').textContent = F.int(S.stats.ascensions);
  }

  function CS_clickPowerSafe() { try { return CC.clickPower(); } catch (e) { return 1; } }

  function refreshAchievements() {
    const S = CC.S;
    D.ACHIEVEMENTS.forEach(function (a) {
      const li = aItems[a.id];
      if (!li) return;
      const unlocked = S.achievements.indexOf(a.id) >= 0;
      li.classList.toggle('locked', !unlocked);
      // Only rewrite title on state change — updating it every tick keeps
      // resetting the browser's native-tooltip hover timer (so it never shows).
      if ((li.dataset.unlocked === '1') !== unlocked) {
        li.dataset.unlocked = unlocked ? '1' : '0';
        li.title = unlocked ? (a.hint || a.desc)
          : '??? — keep playing to reveal this achievement.';
      }
    });
    $('ach-count').textContent = S.achievements.length + ' / ' + D.ACHIEVEMENTS.length;
  }

  /* ---------------- display sync ---------------------------------------
   * Runs on rAF when the compositor is active (smooth), and also on a
   * timer so displays stay correct even where rAF is throttled/paused.
   * ------------------------------------------------------------------ */
  let lastFastText = '';
  function fastLoop() { syncDisplay(); requestAnimationFrame(fastLoop); }

  function syncDisplay() {
    const S = CC.S;

    armyFloat();

    const countText = F.int(S.cookies) + ' cookies';
    if (countText !== lastFastText) { $('cookie-count').textContent = countText; lastFastText = countText; }
    $('cps-value').textContent = F.fmt(CC.cps());
    $('click-power-value').textContent = F.fmt(CS_clickPowerSafe());

    // Buff banner
    const bb = $('buff-banner');
    if (CC.buffActive()) {
      const left = Math.max(0, S.buff.until - Date.now());
      bb.classList.remove('hidden');
      $('buff-name').textContent = 'Frenzy x' + S.buff.mult + ' — ' + Math.ceil(left / 1000) + 's';
      $('buff-bar').style.width = (left / S.buff.dur * 100).toFixed(1) + '%';
    } else {
      bb.classList.add('hidden');
    }

    // Golden cookie show/hide (+ random position on spawn)
    const g = $('golden');
    if (S.goldenActive && S.goldenActive !== lastGoldenRef) {
      lastGoldenRef = S.goldenActive;
      placeGolden();
      g.classList.remove('hidden');
    } else if (!S.goldenActive && lastGoldenRef) {
      lastGoldenRef = null;
      g.classList.add('hidden');
    }

    drainToastsReal();
  }

  function placeGolden() {
    const g = $('golden');
    const pad = 90;
    const x = pad + Math.random() * Math.max(50, window.innerWidth - pad * 2);
    const y = pad + Math.random() * Math.max(50, window.innerHeight - pad * 2);
    g.style.left = (x - 37) + 'px';
    g.style.top = (y - 37) + 'px';
  }

  // Proper toast drain (queue items are {kind,text}).
  function drainToastsReal() {
    while (CC.toasts.length) {
      const t = CC.toasts.shift();
      if (t && typeof t.text === 'string') toast(t.kind, t.text);
    }
  }

  /* ---------------- news ticker ------------------------------------------ */
  let lastNews = -1;
  function rotateNews(force) {
    const nowT = Date.now();
    if (!force && nowT - lastNews < 14000) return;
    lastNews = nowT;
    const i = Math.floor(Math.random() * D.NEWS.length);
    let text = D.NEWS[i]
      .replace('{cps}', F.fmt(CC.cps()))
      .replace('{cookies}', F.fmt(CC.S.allBaked))
      .replace('{who}', D.NEWS_WHO[Math.floor(Math.random() * D.NEWS_WHO.length)]);
    const n = $('news-text');
    n.classList.remove('slide'); void n.offsetWidth;
    n.textContent = text;
    n.classList.add('slide');
  }

  /* ---------------- store panel resizing --------------------------------- */
  const UI_KEY = 'cookieClickerClone.ui.v1';

  function currentStoreW() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--store-w'), 10) || 520;
  }
  function setStoreW(w) {
    // Reserve: resizer (6) + stats column (360) + a usable cookie column (240).
    const app = $('app');
    const maxW = Math.min(900, (app ? app.clientWidth : 1400) - 606);
    w = Math.max(320, Math.min(maxW, Math.round(w)));
    document.documentElement.style.setProperty('--store-w', w + 'px');
  }
  function initResizer() {
    const bar = $('store-resizer');
    if (!bar) return;
    try {
      const p = JSON.parse(window.localStorage.getItem(UI_KEY) || '{}');
      if (p.storeW) setStoreW(p.storeW);
    } catch (e) {}

    let dragging = false;
    bar.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      dragging = true;
      try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      document.body.classList.add('resizing');
    });
    bar.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const appRect = $('app').getBoundingClientRect();
      // Store width = pointer → right edge of the app, minus the stats column.
      setStoreW(appRect.right - e.clientX - 360);
    });
    const end = function () {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing');
      try { window.localStorage.setItem(UI_KEY, JSON.stringify({ storeW: currentStoreW() })); } catch (e) {}
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);

    // Keep the panel in bounds when the window shrinks.
    window.addEventListener('resize', function () { setStoreW(currentStoreW()); });
  }

  /* ---------------- cursor army (auto-production visuals) ---------------- */
  const ARMY_MAX = 12;
  // One full poke cycle, in seconds. MUST match `cursor-poke` duration in css/style.css.
  const ARMY_POKE_PERIOD = 2.6;

  /** Render up to ARMY_MAX little cursors poking at the big cookie. */
  function syncArmy() {
    const host = $('clicker-army');
    if (!host) return;
    const cookieEl = $('big-cookie');
    const want = Math.min(CC.S.buildings.cursor, ARMY_MAX);
    // One neat ring just outside the big cookie's edge, with ~10% breathing
    // room. Uses layout width (offsetWidth), NOT getBoundingClientRect —
    // that one includes live transforms, so the hover-grow/click-squish would
    // make the whole ring pulse in and out with every click.
    const w = cookieEl ? cookieEl.offsetWidth : 280;
    const rad = Math.round((w / 2 + 34) * 1.1);
    if (host.style.getPropertyValue('--rad') !== rad + 'px') host.style.setProperty('--rad', rad + 'px');
    while (host.children.length < want) {
      // army-orbit (angle + spin) > poke-wrap (radial inward poke) > mini-cursor (upright sprite)
      const orbit = document.createElement('span');
      orbit.className = 'army-orbit';
      const wrap = document.createElement('span');
      wrap.className = 'poke-wrap';
      const cur = document.createElement('i');
      cur.className = 'mini-cursor';
      wrap.appendChild(cur);
      orbit.appendChild(wrap);
      host.appendChild(orbit);
    }
    while (host.children.length > want) host.removeChild(host.lastChild);
    // Evenly space the cursors around the circumference, and stagger their pokes
    // by index so the bob travels once around the ring per cycle — a neat wave.
    const n = host.children.length;
    for (let i = 0; i < n; i++) {
      const orbit = host.children[i];
      orbit.style.setProperty('--ang', ((360 / n) * i).toFixed(2) + 'deg');
      // Cursor i pokes exactly one step BEFORE its neighbour, so the poke
      // travels clockwise around the ring — same direction as the orbit.
      orbit.firstChild.style.setProperty('--delay', (-(ARMY_POKE_PERIOD * (1 - i / n))).toFixed(3) + 's');
    }
  }

  let lastArmyFloat = 0;
  /** Occasionally float a "+cps" from the army ring so production is visible. */
  function armyFloat() {
    if (!CC.S.buildings.cursor || CC.cps() <= 0) return;
    const nowT = Date.now();
    if (nowT - lastArmyFloat < 1200 + Math.random() * 1000) return;
    lastArmyFloat = nowT;
    const layer = $('fx-layer'), zone = $('cookie-zone');
    if (!layer || !zone) return;
    const lr = layer.getBoundingClientRect(), zr = zone.getBoundingClientRect();
    const ang = Math.random() * Math.PI * 2;
    const rad = (0.3 + Math.random() * 0.16) * zr.width / 2;
    const f = el('span', 'float-text float-small', '+' + F.fmt(CC.cps()));
    f.style.left = (zr.left - lr.left + zr.width / 2 + Math.cos(ang) * rad).toFixed(0) + 'px';
    f.style.top = (zr.top - lr.top + zr.height / 2 + Math.sin(ang) * rad * 0.94).toFixed(0) + 'px';
    layer.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 950);
  }

  /* ---------------- effects: floating numbers + crumbs -------------------- */
  function spawnClickFx(x, y, amount) {
    const layer = $('fx-layer');
    if (layer.children.length > 60) return; // don't flood the DOM

    const f = el('span', 'float-text', '+' + F.fmt(amount));
    f.style.left = x + 'px';
    f.style.top = y + 'px';
    layer.appendChild(f);
    setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 950);

    for (let i = 0; i < 6; i++) {
      const c = el('span', 'crumb');
      c.style.left = x + 'px';
      c.style.top = y + 'px';
      c.style.setProperty('--dx', (Math.random() * 160 - 80).toFixed(0) + 'px');
      c.style.setProperty('--dy', (-40 - Math.random() * 110).toFixed(0) + 'px');
      c.style.setProperty('--rot', (Math.random() * 540 - 270).toFixed(0) + 'deg');
      layer.appendChild(c);
      setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 750);
    }
  }

  /* ---------------- modal -------------------------------------------------- */
  function showModal(title, body) {
    $('modal-title').textContent = title;
    $('modal-body').textContent = body;
    $('modal').classList.remove('hidden');
    $('modal-ok').focus();
  }
  function hideModal() { $('modal').classList.add('hidden'); }

  /* ---------------- events -------------------------------------------------- */
  function bindEvents() {
    const cookieBtn = $('big-cookie');
    cookieBtn.addEventListener('click', function (e) {
      const gain = CC.click();
      const rect = $('fx-layer').getBoundingClientRect();
      spawnClickFx(e.clientX - rect.left, e.clientY - rect.top, gain);
      cookieBtn.classList.remove('squish'); void cookieBtn.offsetWidth;
      cookieBtn.classList.add('squish');
    });

    $('golden').addEventListener('click', function () {
      const info = CC.goldenClick();
      if (info) toast(info.type === 'frenzy' ? 'frenzy' : 'lucky', info.text);
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function () {
        activeTab = t.dataset.tab;
        document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
        $('building-list').classList.toggle('hidden', activeTab !== 'buildings');
        $('upgrade-grid').classList.toggle('hidden', activeTab !== 'upgrades');
        $('heaven-panel').classList.toggle('hidden', activeTab !== 'heaven');
        refreshStore(); // badge visibility depends on tab
      });
    });

    // Buy quantity
    document.querySelectorAll('.qbtn').forEach(function (b) {
      b.addEventListener('click', function () {
        buyQty = parseInt(b.dataset.qty, 10);
        document.querySelectorAll('.qbtn').forEach(function (x) { x.classList.toggle('active', x === b); });
        refreshStore();
      });
    });

    // Ascension
    $('btn-ascend').addEventListener('click', function () {
      const pot = CC.potentialChips();
      if (pot < 1) return;
      if (!confirm('Ascend for ' + pot + ' heavenly chip' + (pot > 1 ? 's' : '') + '?\n\nYour cookies, buildings and upgrades will be reset. Achievements and the heavenly shop are kept.')) return;
      if (CC.ascend()) { CC.save(); refreshStore(); }
    });

    // Settings
    $('btn-save').addEventListener('click', function () { CC.save(); toast('info', 'Game saved.'); });
    $('btn-reset').addEventListener('click', function () {
      if (!confirm('HARD RESET: erase ALL progress, including heavenly chips and achievements?')) return;
      if (!confirm('Are you absolutely sure? This cannot be undone.')) return;
      try { window.localStorage.removeItem(CC.SAVE_KEY); } catch (e) {}
      location.reload();
    });

    $('modal-ok').addEventListener('click', hideModal);
    $('modal').addEventListener('click', function (e) { if (e.target === this) hideModal(); });

    // Autosave
    window.addEventListener('beforeunload', function () { CC.save(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) CC.save(); });
  }

  /* ---------------- init ------------------------------------------------------ */
  function init() {
    const offline = CC.load();

    buildBuildingList();
    buildUpgradeGrid();
    buildHeavenPanel();
    buildStats();
    buildAchievements();
    initResizer();
    bindEvents();

    rotateNews(true);
    refreshStore();

    if (offline && offline.gained > 0.5) {
      showModal('While you were away…',
        'Your cookies kept baking for ' + F.time(offline.ms) + '. You earned ' + F.fmt(offline.gained) + ' cookies!');
    }

    // Display sync: rAF for smoothness + a timer fallback (throttled tabs).
    requestAnimationFrame(fastLoop);
    setInterval(syncDisplay, 250);

    // Engine clock. Timestamped ticks so throttled background tabs can't lose time.
    let lastTickAt = performance.now();
    setInterval(function () {
      const t = performance.now();
      CC.tick(t - lastTickAt);
      lastTickAt = t;
    }, 100);

    // Slow loops.
    setInterval(refreshStore, 250);
    setInterval(function () { rotateNews(false); }, 1000);
    setInterval(function () { CC.save(); }, 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

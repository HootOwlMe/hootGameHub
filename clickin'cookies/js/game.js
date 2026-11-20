/* =====================================================================
 * Cookie Clicker clone — core game engine.
 * NO DOM access in this file (safe to run headless under Node for tests).
 * Exposes window.CC with the full public API used by ui.js.
 *
 * Economy model (see README.md for details & deviations from original):
 *   cps      = Σ(units × unitCps × buildingMults) × globalAll × buffMult
 *   globalAll= (1 + 2%·chips) × (1 + 2%·achievements) × Π(allMult upgrades)
 *   click    = [(1 + baseClickAdds) × Π(clickMults) + cps × Σ(clickCpsPct)] × frenzy
 *   cost(nth) = ceil(baseCost × 1.15^owned)
 * ===================================================================*/
(function (global) {
  'use strict';

  if (!global.CC_DATA) throw new Error('CC_DATA missing — load data.js before game.js');
  const D = global.CC_DATA;
  const T = D.TUNING;
  const F = global.CC_FMT || { fmt: String, int: String };

  /* ---------------- storage shim (localStorage, fault-tolerant) ------ */
  const SAVE_KEY = 'cookieClickerClone.save.v1';
  const store = {
    get(k) { try { return global.localStorage ? global.localStorage.getItem(k) : null; } catch (e) { return null; } },
    set(k, v) { try { if (global.localStorage) global.localStorage.setItem(k, String(v)); } catch (e) { /* private mode etc. */ } },
    del(k) { try { if (global.localStorage) global.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ---------------- state ------------------------------------------- */
  let S = null;

  function freshState() {
    const buildings = {};
    D.BUILDINGS.forEach(function (b) { buildings[b.id] = 0; });
    return {
      v: 1,
      cookies: 0,          // in the bank
      runBaked: 0,         // baked this ascension run
      allBaked: 0,         // baked across all time
      buildings: buildings,
      upgrades: [],        // purchased UPGRADES ids
      hUpgrades: [],       // purchased H_UPGRADES ids (persist through ascension)
      achievements: [],    // unlocked achievement ids (persist forever)
      chips: 0,            // heavenly chips
      stats: { clicks: 0, goldenClicked: 0, frenzies: 0, playtimeMs: 0, ascensions: 0 },
      buff: null,          // { type:'frenzy', until:<ms epoch>, mult, dur }
      goldenActive: null,  // { leftMs } while a golden cookie is on screen
      nextGoldenIn: 25000 + Math.random() * 15000,
      lastSeen: Date.now(),
      _cpsCache: 0,        // internal cache — not meaningful to persist
      _dirty: true
    };
  }

  function now() { return Date.now(); }

  function totalBuildings() {
    let t = 0;
    for (const k in S.buildings) t += S.buildings[k];
    return t;
  }

  /* ---------------- multipliers -------------------------------------- */
  /** True when an upgrade's effect applies to building `id`.
   *  Handles single-building effects ({building}) and pair synergies
   *  ({buildings: [a, b]}). */
  function effectHitsBuilding(u, id) {
    if (!u.effect) return false;
    if (u.effect.building === id) return true;
    return !!(Array.isArray(u.effect.buildings) && u.effect.buildings.indexOf(id) >= 0);
  }

  function buildingMult(id) {
    let m = 1;
    for (const u of D.UPGRADES) {
      if (effectHitsBuilding(u, id) && S.upgrades.indexOf(u.id) >= 0) m *= (u.effect.value || 2);
    }
    return m;
  }

  function globalAll() {
    let m = 1 + T.CHIP_BONUS * S.chips;              // heavenly chips: +2% each
    m *= 1 + T.ACHIEVEMENT_BONUS * S.achievements.length; // achievements: +2% each
    for (const u of D.UPGRADES) {
      if (u.effect && u.effect.allMult && S.upgrades.indexOf(u.id) >= 0) m *= u.effect.allMult;
    }
    for (const h of D.H_UPGRADES) {
      if (h.effect && h.effect.allMult && S.hUpgrades.indexOf(h.id) >= 0) m *= h.effect.allMult;
    }
    return m;
  }

  function buffActive() { return !!(S.buff && S.buff.type === 'frenzy' && S.buff.until > now()); }

  /** Pure CPS computation — does NOT touch the cache/dirty flag.
   *  Used by achievement checks, which must not consume staleness. */
  function computeCps() {
    let base = 0;
    for (const b of D.BUILDINGS) base += S.buildings[b.id] * b.cps * buildingMult(b.id);
    return base * globalAll() * (buffActive() ? S.buff.mult : 1);
  }

  function recomputeCps() {
    S._cpsCache = computeCps();
    S._dirty = false;
  }

  function cps() { if (S._dirty) recomputeCps(); return S._cpsCache; }

  /* ---------------- economy ------------------------------------------ */
  function addCookies(n) {
    if (!(n > 0)) return;
    S.cookies += n; S.runBaked += n; S.allBaked += n;
  }

  function clickPower() {
    let base = 1, mult = 1, pct = 0;
    for (const u of D.UPGRADES) if (S.upgrades.indexOf(u.id) >= 0 && u.effect) {
      if (u.effect.baseClickAdd) base += u.effect.baseClickAdd;
      if (u.effect.clickMult) mult *= u.effect.clickMult;
      if (u.effect.clickCpsPct) pct += u.effect.clickCpsPct;
    }
    for (const h of D.H_UPGRADES) if (S.hUpgrades.indexOf(h.id) >= 0 && h.effect) {
      if (h.effect.baseClickAdd) base += h.effect.baseClickAdd;
    }
    // Frenzy multiplies ALL production, clicks included. The CpS term is
    // already buffed inside cps(); this covers the base × mult part as well.
    return (base * mult + cps() * pct) * (buffActive() ? S.buff.mult : 1);
  }

  /** Player clicked the big cookie. Returns cookies gained. */
  function click() {
    S.stats.clicks++;
    const g = clickPower();
    addCookies(g);
    checkAchievements();
    return g;
  }

  /* ---------------- buildings ---------------------------------------- */
  function buildingById(id) { for (const b of D.BUILDINGS) if (b.id === id) return b; return null; }

  /** Total cost of buying `n` units starting from the current owned count. */
  function buildingCost(id, n) {
    const b = buildingById(id);
    if (!b) return Infinity;
    let total = 0;
    const o = S.buildings[id];
    for (let i = 0; i < n; i++) total += Math.ceil(b.baseCost * Math.pow(T.COST_GROWTH, o + i));
    return total;
  }

  function buyBuilding(id, n) {
    const cost = buildingCost(id, n);
    if (!isFinite(cost) || S.cookies < cost) return false;
    S.cookies -= cost;
    S.buildings[id] += n;
    S._dirty = true;
    checkAchievements();
    return true;
  }

  /* ---------------- upgrades ----------------------------------------- */
  function upgradeById(id) { for (const u of D.UPGRADES) if (u.id === id) return u; return null; }

  function upgradeReqMet(u) {
    const r = u.req || {};
    if (r.building && S.buildings[r.building] < r.count) return false;
    if (Array.isArray(r.buildings)) {
      for (const bb of r.buildings) if (S.buildings[bb.building] < bb.count) return false;
    }
    if (r.clicks && S.stats.clicks < r.clicks) return false;
    if (r.runBaked && S.runBaked < r.runBaked) return false;
    if (r.allBaked && S.allBaked < r.allBaked) return false;
    if (r.goldenClicked && S.stats.goldenClicked < r.goldenClicked) return false;
    if (r.totalBuildings && totalBuildings() < r.totalBuildings) return false;
    return true;
  }

  function upgradeVisible(u) {
    return S.upgrades.indexOf(u.id) < 0 && upgradeReqMet(u);
  }

  function buyUpgrade(id) {
    const u = upgradeById(id);
    if (!u || !upgradeVisible(u) || S.cookies < u.cost) return false;
    S.cookies -= u.cost;
    S.upgrades.push(id);
    S._dirty = true;
    checkAchievements();
    return true;
  }

  /* ---------------- heavenly shop ------------------------------------ */
  function hUpgradeById(id) { for (const h of D.H_UPGRADES) if (h.id === id) return h; return null; }

  function buyHUpgrade(id) {
    const h = hUpgradeById(id);
    if (!h || S.hUpgrades.indexOf(id) >= 0 || S.chips < h.cost) return false;
    S.chips -= h.cost;
    S.hUpgrades.push(id);
    S._dirty = true;
    checkAchievements();
    return true;
  }

  /** First heavenly-upgrade effect value for a key (e.g. offlineHours). */
  function hEffect(key) {
    for (const id of S.hUpgrades) {
      const h = hUpgradeById(id);
      if (h && h.effect && h.effect[key] !== undefined) return h.effect[key];
    }
    return null;
  }

  /** First regular-upgrade effect value for a key (e.g. offlineHours). */
  function upgradeEffect(key) {
    for (const id of S.upgrades) {
      const u = upgradeById(id);
      if (u && u.effect && u.effect[key] !== undefined) return u.effect[key];
    }
    return null;
  }

  /* ---------------- golden cookies ----------------------------------- */
  function gcIntervalMs() {
    let m = T.GOLDEN_MIN_MS + Math.random() * (T.GOLDEN_MAX_MS - T.GOLDEN_MIN_MS);
    for (const u of D.UPGRADES) if (S.upgrades.indexOf(u.id) >= 0 && u.effect.gcInterval) m *= u.effect.gcInterval;
    const h = hEffect('gcInterval'); // note: heavenly "Lucky halo" uses gcInterval too
    if (h !== null) m *= h;
    return Math.max(15000, m);
  }

  function frenzyMultValue() {
    let m = T.FRENZY_MULT;
    for (const u of D.UPGRADES) if (S.upgrades.indexOf(u.id) >= 0 && u.effect.frenzyMult) m = u.effect.frenzyMult;
    return m;
  }

  function luckyPctValue() {
    let p = 1;
    for (const u of D.UPGRADES) if (S.upgrades.indexOf(u.id) >= 0 && u.effect.luckyPct) p *= u.effect.luckyPct;
    return p;
  }

  function spawnGolden() { S.goldenActive = { leftMs: T.GOLDEN_LIFE_MS }; }

  /** Player clicked the golden cookie. Returns {type, text, amount?} or null. */
  function goldenClick() {
    if (!S.goldenActive) return null;
    S.goldenActive = null;
    S.stats.goldenClicked++;
    S.nextGoldenIn = gcIntervalMs();

    let info;
    if (Math.random() < 0.5) {
      const mult = frenzyMultValue();
      const dur = T.FRENZY_DUR_MS;
      S.buff = { type: 'frenzy', until: now() + dur, mult: mult, dur: dur };
      S.stats.frenzies++;
      S._dirty = true;
      info = { type: 'frenzy', text: 'Frenzy! Production x' + mult + ' for ' + Math.round(dur / 1000) + 's.' };
    } else {
      const gain = Math.max(13, Math.floor(cps() * T.LUCKY_CPS_SECONDS)) * luckyPctValue();
      addCookies(gain);
      info = { type: 'lucky', amount: gain, text: 'Lucky! +' + F.fmt(gain) + ' cookies.' };
    }
    checkAchievements();
    return info;
  }

  /* ---------------- achievements -------------------------------------- */
  function ctx() {
    return { cps: computeCps, totalBuildings: totalBuildings, inFrenzy: buffActive };
  }

  function checkAchievements() {
    let changed = false;
    for (const a of D.ACHIEVEMENTS) {
      if (S.achievements.indexOf(a.id) >= 0) continue;
      try {
        if (a.check(S, ctx())) {
          S.achievements.push(a.id);
          changed = true;
          CC.toasts.push({ kind: 'ach', text: 'Achievement unlocked — ' + a.name });
        }
      } catch (e) { /* defensive: never let a check kill the game */ }
    }
    if (changed) S._dirty = true; // production bonus changed
  }

  /* ---------------- main tick ----------------------------------------
   * Called by the UI render loop with real elapsed milliseconds.
   * ------------------------------------------------------------------ */
  let _achCd = 0;
  function tick(dtMs) {
    if (dtMs <= 0) return;
    const dt = Math.min(dtMs, 6 * 3600e3); // safety cap; absences are handled by offline earnings on load

    S.stats.playtimeMs += dt;

    if (S.buff && now() > S.buff.until) { S.buff = null; S._dirty = true; }

    addCookies(cps() * dt / 1000);

    if (S.goldenActive) {
      S.goldenActive.leftMs -= dt;
      if (S.goldenActive.leftMs <= 0) {
        S.goldenActive = null;
        // Restart the spawn timer on natural expiry — otherwise the stale
        // countdown (already ≤ 0 from the previous spawn) respawns a new
        // golden cookie on the very next tick.
        S.nextGoldenIn = gcIntervalMs();
      }
    } else {
      S.nextGoldenIn -= dt;
      if (S.nextGoldenIn <= 0) spawnGolden();
    }

    _achCd += dt;
    if (_achCd >= 1000) { _achCd = 0; checkAchievements(); }
  }

  /* ---------------- ascension ---------------------------------------- */
  function potentialChips() {
    return Math.floor(Math.pow(S.runBaked / T.ASCEND_DIVISOR, 0.4));
  }

  /** Reset the run for heavenly chips. Returns true on success. */
  function ascend() {
    const c = potentialChips();
    if (c < 1) return false;

    // Capture what survives ascension, then rebuild a fresh state.
    const prevAllBaked = S.allBaked;
    const prevAchievements = S.achievements.slice();
    const prevHUpgrades = S.hUpgrades.slice();
    const prevStats = JSON.parse(JSON.stringify(S.stats));

    S = freshState();
    S.allBaked = prevAllBaked;
    S.chips += c;
    S.achievements = prevAchievements;
    S.hUpgrades = prevHUpgrades;
    S.stats = prevStats;
    S.stats.ascensions += 1;
    S._dirty = true;
    checkAchievements();
    CC.toasts.push({ kind: 'info', text: 'Ascended! +' + c + ' heavenly chip' + (c > 1 ? 's' : '') });
    return true;
  }

  /* ---------------- save / load --------------------------------------- */
  function save() {
    if (!S) return false;
    S.lastSeen = now();
    store.set(SAVE_KEY, JSON.stringify(S));
    return true;
  }

  /** Load a save (or start fresh). Returns offline-earnings info or null. */
  function load() {
    const raw = store.get(SAVE_KEY);
    let ok = false;
    if (raw) {
      try {
        const p = JSON.parse(raw);
        S = freshState();
        for (const k in S) if (p[k] !== undefined && typeof p[k] === typeof S[k]) S[k] = p[k];
        S.buildings = Object.assign(freshState().buildings, p.buildings || {});
        S.stats = Object.assign(freshState().stats, p.stats || {});
        S.upgrades = Array.isArray(p.upgrades) ? p.upgrades : [];
        S.hUpgrades = Array.isArray(p.hUpgrades) ? p.hUpgrades : [];
        S.achievements = Array.isArray(p.achievements) ? p.achievements : [];
        S.buff = (p.buff && typeof p.buff.until === 'number' && p.buff.until > now()) ? p.buff : null;
        S.goldenActive = null; // never restore an in-flight golden cookie
        S._dirty = true;       // recompute CPS against the current clock
        ok = true;
      } catch (e) { /* corrupted save -> fresh start */ }
    }
    if (!ok) S = freshState();
    return offlineEarnings();
  }

  /** Grant cookies earned while away (called by load()). */
  function offlineEarnings() {
    let capHours = T.OFFLINE_CAP_HOURS, rate = 1;
    const hCap = hEffect('offlineHours');   if (hCap !== null) capHours = Math.max(capHours, hCap);
    const uCap = upgradeEffect('offlineHours'); if (uCap !== null) capHours = Math.max(capHours, uCap);
    const hRate = hEffect('offlineRate');   if (hRate !== null) rate = Math.max(rate, hRate);
    const dt = now() - S.lastSeen;
    if (dt < T.OFFLINE_MIN_MS) return null;
    const t = Math.min(dt, capHours * 3600e3);
    const gained = cps() * (t / 1000) * rate;
    addCookies(gained);
    S.lastSeen = now();
    return { ms: dt, gained: gained };
  }

  /* ---------------- public API ---------------------------------------- */
  const CC = {
    toasts: [],          // UI drains this queue for toast notifications
    SAVE_KEY: SAVE_KEY,
    get S() { return S; },
    newGame: function () { S = freshState(); checkAchievements(); return S; },
    load: load,
    save: save,
    tick: tick,
    click: click,
    cps: cps,
    clickPower: clickPower,
    buildingById: buildingById,
    buildingCost: buildingCost,
    buyBuilding: buyBuilding,
    upgradeById: upgradeById,
    upgradeReqMet: upgradeReqMet,
    upgradeVisible: upgradeVisible,
    buyUpgrade: buyUpgrade,
    hUpgradeById: hUpgradeById,
    buyHUpgrade: buyHUpgrade,
    hEffect: hEffect,
    spawnGoldenForTest: spawnGolden,
    goldenClick: goldenClick,
    buffActive: buffActive,
    checkAchievements: checkAchievements,
    totalBuildings: totalBuildings,
    potentialChips: potentialChips,
    ascend: ascend,
    offlineEarnings: offlineEarnings
  };

  global.CC = CC;
})(typeof window !== 'undefined' ? window : globalThis);

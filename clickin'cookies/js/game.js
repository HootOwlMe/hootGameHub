/* =====================================================================
 * Cookie Clicker clone — core game engine.
 * NO DOM access in this file (safe to run headless under Node for tests).
 * Exposes window.CC with the full public API used by ui.js.
 *
 * Economy model (see README.md for details & deviations from original):
 *   cps      = Σ(units × unitCps × buildingMults) × globalAll × buffMult
 *   globalAll= (1 + chipBonus·chips) × (1 + 2%·achievements)
 *             × (1 + ascendBonus·ascensions, from heaven)
 *             × Π(allMult upgrades, incl. heavenly tiers)
 *   click    = [(1 + baseClickAdds) × Π(clickMults) + cps × Σ(clickCpsPct)] × frenzy
 *              (heavenly upgrades can add to all three click terms)
 *   cost(nth) = ceil(baseCost × 1.15^owned × heavenlyCostDiscount)
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
      consumableBuffs: {}, // id -> { until, cdUntil } active + cooling consumables (ms epochs)
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

  /** Effective per-chip production bonus (Angel's favor raises it). */
  function chipBonus() { const add = hEffect('chipBonusAdd'); return T.CHIP_BONUS + (add !== null ? add : 0); }

  /** Per-ascension production bonus rate from the Ascendant soul blessing. */
  function ascensionBonusRate() { const r = hEffect('perAscension'); return r !== null ? r : 0; }

  /** Building price multiplier (Bargain heaven < 1). Min wins if ever tiered. */
  function costMult() {
    let m = 1;
    for (const id of S.hUpgrades) {
      const h = hUpgradeById(id);
      if (h && h.effect && h.effect.buildingCostMult !== undefined && h.effect.buildingCostMult < m) m = h.effect.buildingCostMult;
    }
    return m;
  }

  function globalAll() {
    let m = 1 + chipBonus() * S.chips;               // heavenly chips (base +2% each, upgradeable)
    m *= 1 + T.ACHIEVEMENT_BONUS * S.achievements.length; // achievements: +2% each
    const ap = ascensionBonusRate();
    if (ap > 0) m *= 1 + ap * S.stats.ascensions;    // Ascendant soul: permanent per-ascension bonus
    for (const u of D.UPGRADES) {
      if (u.effect && u.effect.allMult && S.upgrades.indexOf(u.id) >= 0) m *= u.effect.allMult;
    }
    for (const h of D.H_UPGRADES) {
      if (h.effect && h.effect.allMult && S.hUpgrades.indexOf(h.id) >= 0) m *= h.effect.allMult;
    }
    return m;
  }

  function buffActive() { return !!(S.buff && S.buff.type === 'frenzy' && S.buff.until > now()); }

  /** Production multiplier from ACTIVE consumable buffs (multiplicative).
   *  Pure read — does not touch the cache/dirty flag. */
  function consumableProdMult() {
    let m = 1;
    const t = now();
    for (const id in S.consumableBuffs) {
      if (S.consumableBuffs[id].until <= t) continue;
      const c = consumableById(id);
      if (c && c.effect && c.effect.prodMult) m *= c.effect.prodMult;
    }
    return m;
  }

  /** Click-power multiplier from ACTIVE consumable buffs. */
  function consumableClickMult() {
    let m = 1;
    const t = now();
    for (const id in S.consumableBuffs) {
      if (S.consumableBuffs[id].until <= t) continue;
      const c = consumableById(id);
      if (c && c.effect && c.effect.clickMult) m *= c.effect.clickMult;
    }
    return m;
  }

  /** Pure CPS computation — does NOT touch the cache/dirty flag.
   *  Used by achievement checks, which must not consume staleness. */
  function computeCps() {
    let base = 0;
    for (const b of D.BUILDINGS) base += S.buildings[b.id] * b.cps * buildingMult(b.id);
    return base * globalAll() * (buffActive() ? S.buff.mult : 1) * consumableProdMult();
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
      if (h.effect.clickMult) mult *= h.effect.clickMult;       // Serenity of touch
      if (h.effect.clickCpsPct) pct += h.effect.clickCpsPct;    // Divine fingers
    }
    // Frenzy multiplies ALL production, clicks included. The CpS term is
    // already buffed inside cps(); this covers the base × mult part as well.
    return (base * mult + cps() * pct) * (buffActive() ? S.buff.mult : 1) * consumableClickMult();
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
    const cm = costMult(); // heavenly discount (Bargain heaven)
    for (let i = 0; i < n; i++) total += Math.ceil(b.baseCost * Math.pow(T.COST_GROWTH, o + i) * cm);
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

  /* ---------------- consumables (temporary power-ups) -----------------
   * Price = baseCost + bankPct × CURRENT cookie bank, so a purchase always
   * costs a meaningful slice of what you hold. Only ONE consumable can be
   * active at a time — while one runs, the others cannot be started (their
   * per-item cooldowns still run independently after they end: cooldownMs,
   * scaled with power). The active effect stacks on top of golden-cookie
   * frenzy. S.consumableBuffs[id] = { until, cdUntil } (ms epochs; cdUntil > until). */
  function consumableById(id) { for (const c of D.CONSUMABLES) if (c.id === id) return c; return null; }

  /** Live price (depends on the current bank). Infinity for unknown ids. */
  function consumableCost(id) {
    const c = consumableById(id);
    if (!c) return Infinity;
    return Math.ceil(c.baseCost + c.bankPct * S.cookies);
  }

  /** Buy a consumable. Returns false if another power-up is running, this one
   *  is on cooldown, or it is too expensive. */
  function buyConsumable(id) {
    const c = consumableById(id);
    if (!c) return false;
    const t = now();
    // One at a time: refuse to start while any OTHER consumable is active.
    for (const otherId in S.consumableBuffs) {
      if (otherId !== id && S.consumableBuffs[otherId].until > t) return false;
    }
    const existing = S.consumableBuffs[id];
    if (existing && existing.cdUntil > t) return false; // active or cooling
    const cost = consumableCost(id);
    if (!isFinite(cost) || S.cookies < cost) return false;
    S.cookies -= cost;
    const until = t + c.durMs;
    S.consumableBuffs[id] = { until: until, cdUntil: until + c.cooldownMs };
    S._dirty = true;
    checkAchievements();
    return true;
  }

  /* ---------------- heavenly shop ------------------------------------ */
  function hUpgradeById(id) { for (const h of D.H_UPGRADES) if (h.id === id) return h; return null; }

  /** True when a heavenly upgrade's prerequisite (if any) is owned. */
  function hReqMet(h) {
    const r = h && h.req;
    if (!r || !r.hUpgrade) return true;
    return S.hUpgrades.indexOf(r.hUpgrade) >= 0;
  }

  function buyHUpgrade(id) {
    const h = hUpgradeById(id);
    if (!h || S.hUpgrades.indexOf(id) >= 0 || S.chips < h.cost) return false;
    if (!hReqMet(h)) return false; // tier chain: requires the previous blessing
    S.chips -= h.cost;
    S.hUpgrades.push(id);
    S._dirty = true;
    checkAchievements();
    return true;
  }

  /** First heavenly-upgrade effect value for a key (e.g. keepPct). */
  function hEffect(key) {
    for (const id of S.hUpgrades) {
      const h = hUpgradeById(id);
      if (h && h.effect && h.effect[key] !== undefined) return h.effect[key];
    }
    return null;
  }

  /** MAX effect value across owned heavenly upgrades — for tiered caps where a
   *  later blessing raises the same key (offlineHours, offlineRate, frenzyDur). */
  function hMax(key) {
    let best = null;
    for (const id of S.hUpgrades) {
      const h = hUpgradeById(id);
      if (h && h.effect && typeof h.effect[key] === 'number' && (best === null || h.effect[key] > best)) best = h.effect[key];
    }
    return best;
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
    const h = hEffect('frenzyMult'); // Divine fervor
    if (h !== null && h > m) m = h;
    return m;
  }

  function frenzyDurMs() {
    let d = T.FRENZY_DUR_MS;
    const h = hMax('frenzyDur'); // Divine fervor
    if (h !== null) d = Math.max(d, h);
    return d;
  }

  function luckyPctValue() {
    let p = 1;
    for (const u of D.UPGRADES) if (S.upgrades.indexOf(u.id) >= 0 && u.effect.luckyPct) p *= u.effect.luckyPct;
    const h = hEffect('luckyPct'); // Fortune's smile
    if (h !== null) p *= h;
    return p;
  }

  /** True while any ACTIVE consumable buff suppresses golden-cookie spawns
   *  (data flag effect.suppressGolden — Antimatter shakeup). */
  function goldenSuppressed() {
    const t = now();
    for (const id in S.consumableBuffs) {
      if (S.consumableBuffs[id].until <= t) continue;
      const c = consumableById(id);
      if (c && c.effect && c.effect.suppressGolden) return true;
    }
    return false;
  }

  function spawnGolden() { S.goldenActive = { leftMs: T.GOLDEN_LIFE_MS }; }

  /** Player clicked the golden cookie. Returns {type, text, amount?} or null.
   *  force: optional 'frenzy'|'lucky' (tests); omitted -> 50/50 random. */
  function goldenClick(force) {
    if (!S.goldenActive) return null;
    S.goldenActive = null;
    S.stats.goldenClicked++;
    S.nextGoldenIn = gcIntervalMs();

    let info;
    const isFrenzy = force ? (force === 'frenzy') : (Math.random() < 0.5);
    if (isFrenzy) {
      const mult = frenzyMultValue();
      const dur = frenzyDurMs();
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
    const t = now();

    S.stats.playtimeMs += dt;

    if (S.buff && t > S.buff.until) { S.buff = null; S._dirty = true; }

    // Consumables: invalidate the CPS cache the moment an effect ENDS
    // (the entry lingers until its cooldown finishes so the UI can show it),
    // then drop fully-cooled entries.
    for (const id in S.consumableBuffs) {
      const b = S.consumableBuffs[id];
      if (b.until <= t && !b.expiredNoted) { b.expiredNoted = true; S._dirty = true; }
      if (b.cdUntil <= t) delete S.consumableBuffs[id];
    }

    addCookies(cps() * dt / 1000);

    // Golden cookies don't appear while an active consumable suppresses them
    // (Antimatter shakeup): the spawn countdown pauses and resumes when it ends.
    const gcSuppressed = goldenSuppressed();

    if (S.goldenActive) {
      // A cookie already on screen keeps its lifetime — suppression only stops NEW spawns.
      S.goldenActive.leftMs -= dt;
      if (S.goldenActive.leftMs <= 0) {
        S.goldenActive = null;
        // Restart the spawn timer on natural expiry — otherwise the stale
        // countdown (already ≤ 0 from the previous spawn) respawns a new
        // golden cookie on the very next tick.
        S.nextGoldenIn = gcIntervalMs();
      }
    } else if (!gcSuppressed) {
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

  /** Run-baked threshold for the NEXT chip (progress bar target). */
  function nextChipAt() {
    // chips(r) = floor((r/D)^0.4); first r with >= pot+1 chips: D * (pot+1)^(1/0.4)
    return T.ASCEND_DIVISOR * Math.pow(potentialChips() + 1, 2.5);
  }

  /** Reset the run for heavenly chips. Returns true on success. */
  function ascend() {
    const c = potentialChips();
    if (c < 1) return false;

    // Capture what survives ascension, then rebuild a fresh state.
    const prevRunBaked = S.runBaked;
    const prevAllBaked = S.allBaked;
    const prevChips = S.chips;           // unspent banked chips survive too
    const prevAchievements = S.achievements.slice();
    const prevHUpgrades = S.hUpgrades.slice();
    const prevStats = JSON.parse(JSON.stringify(S.stats));

    S = freshState();
    S.allBaked = prevAllBaked;
    S.chips = prevChips + c;
    S.achievements = prevAchievements;
    S.hUpgrades = prevHUpgrades;
    S.stats = prevStats;
    S.stats.ascensions += 1;
    // Heavenly grant: keep a slice of this run's baked cookies as a head start.
    const keepPct = hEffect('keepPct');
    if (keepPct !== null && prevRunBaked > 0) {
      S.cookies = Math.floor(prevRunBaked * keepPct); // banked only — doesn't count toward run progress
    }
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
        // Consumables: keep only well-formed entries (active OR cooling).
        for (const id in (S.consumableBuffs || {})) {
          const b = S.consumableBuffs[id];
          if (!b || typeof b.until !== 'number' || typeof b.cdUntil !== 'number') delete S.consumableBuffs[id];
        }
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
    const hCap = hMax('offlineHours');      if (hCap !== null) capHours = Math.max(capHours, hCap);
    const uCap = upgradeEffect('offlineHours'); if (uCap !== null) capHours = Math.max(capHours, uCap);
    const hRate = hMax('offlineRate');      if (hRate !== null) rate = Math.max(rate, hRate);
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
    consumableById: consumableById,
    consumableCost: consumableCost,
    buyConsumable: buyConsumable,
    hUpgradeById: hUpgradeById,
    buyHUpgrade: buyHUpgrade,
    hReqMet: hReqMet,
    hEffect: hEffect,
    chipBonus: chipBonus,
    ascensionBonusRate: ascensionBonusRate,
    costMult: costMult,
    nextChipAt: nextChipAt,
    spawnGoldenForTest: spawnGolden,
    goldenClick: goldenClick,
    buffActive: buffActive,
    goldenSuppressed: goldenSuppressed,
    checkAchievements: checkAchievements,
    totalBuildings: totalBuildings,
    potentialChips: potentialChips,
    ascend: ascend,
    offlineEarnings: offlineEarnings
  };

  global.CC = CC;
})(typeof window !== 'undefined' ? window : globalThis);

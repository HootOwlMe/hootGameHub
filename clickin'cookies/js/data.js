/* =====================================================================
 * Cookie Clicker clone — static game data.
 * No external assets: everything here is plain numbers/strings.
 * Exposed as window.CC_DATA (or globalThis.CC_DATA under Node for tests).
 * ===================================================================*/
(function (global) {
  'use strict';

  /* ---------------- Buildings ----------------------------------------
   * baseCost : price of the first one (scales x1.15 per owned)
   * cps      : cookies per second produced by ONE unit, before upgrades
   * ------------------------------------------------------------------ */
  const BUILDINGS = [
    { id: 'cursor',     name: 'Cursor',               baseCost: 15,       cps: 0.1,    blurb: 'Auto-clicks once every 10 seconds.' },
    { id: 'grandma',    name: 'Grandma',              baseCost: 100,      cps: 1,      blurb: 'A nice grandma to bake more cookies.' },
    { id: 'farm',       name: 'Farm',                 baseCost: 1100,     cps: 8,      blurb: 'Grows cookie plants from cookie seeds.' },
    { id: 'mine',       name: 'Mine',                 baseCost: 12000,    cps: 47,     blurb: 'Mines out cookie dough and chocolate chips.' },
    { id: 'factory',    name: 'Factory',              baseCost: 130000,   cps: 260,    blurb: 'Produces large quantities of industrial cookies.' },
    { id: 'bank',       name: 'Bank',                 baseCost: 1400000,  cps: 1400,   blurb: 'Interest from all those cookies adds up.' },
    { id: 'temple',     name: 'Temple',               baseCost: 2e7,      cps: 7800,   blurb: 'An ancient temple dedicated to the Great Cookie.' },
    { id: 'wizard',     name: 'Wizard tower',         baseCost: 3.3e8,    cps: 44000,  blurb: 'Summons cookies with arcane magic.' },
    // Shipment and above got a +50% base-CpS buff (late-game pacing).
    { id: 'shipment',   name: 'Shipment',             baseCost: 5.1e9,    cps: 390000, blurb: 'Brings in fresh cookies from the Cookie Planet.' },
    { id: 'alchemy',    name: 'Alchemy lab',          baseCost: 7.5e10,   cps: 2.4e6,  blurb: 'Turns gold into cookies. (The reverse of normal alchemy.)' },
    { id: 'portal',     name: 'Portal',               baseCost: 1e12,     cps: 1.5e7,  blurb: 'Opens a door to the Cookieverse, where cookies are native.' },
    { id: 'timemachine',name: 'Time machine',         baseCost: 1.4e13,   cps: 9.75e7, blurb: 'Brings cookies from the past, before they were even eaten.' },
    { id: 'antimatter', name: 'Antimatter condenser', baseCost: 1.7e14,   cps: 6.45e8, blurb: 'Condenses raw antimatter into sweet, sweet cookies.' },
    { id: 'prism',      name: 'Prism',                baseCost: 2.1e15,   cps: 4.35e9, blurb: 'Refines pure light into cookies of flawless quality.' }
  ];

  /* ---------------- Upgrades ----------------------------------------- */
  const UPGRADES = [];

  // Per-building tiers: unlock at N owned; each doubles that building's output.
  const B_TIER_REQ   = [1, 5, 25, 50, 100, 200];
  const B_TIER_COST  = [8, 60, 400, 3000, 10000, 40000]; // x baseCost of the building
  const B_TIER_NAMES = ['I', 'II', 'III', 'IV', 'V', 'VI'];

  BUILDINGS.forEach(function (b) {
    B_TIER_REQ.forEach(function (req, i) {
      UPGRADES.push({
        id: b.id + '_u' + (i + 1),
        name: b.name + ' ' + B_TIER_NAMES[i],
        cost: Math.ceil(b.baseCost * B_TIER_COST[i]),
        desc: b.name + ' output x2.',
        req: { building: b.id, count: req },
        effect: { building: b.id, value: 2 }
      });
    });
  });

  // Global / special upgrades.
  UPGRADES.push(
    { id: 'click_1', name: 'Reinforced index finger',   cost: 500,    desc: 'Clicking power x2.',                    req: { clicks: 10 },      effect: { clickMult: 2 } },
    { id: 'click_2', name: 'Carpal tunnel cream',       cost: 15000,  desc: 'Clicking power x3 (stacks).',           req: { clicks: 100 },     effect: { clickMult: 3 } },
    { id: 'click_3', name: 'Ambidextrous',              cost: 9e4,    desc: 'Each click also earns +2% of your CpS.',req: { runBaked: 5e5 },   effect: { clickCpsPct: 0.02 } },
    { id: 'click_5', name: 'Steady hands',              cost: 3e5,    desc: 'Clicking power x2 (stacks).',           req: { clicks: 800 },     effect: { clickMult: 2 } },
    { id: 'all_2',   name: 'Cookie synergy',            cost: 4e5,    desc: 'All building output x1.5.',             req: { totalBuildings: 50 },  effect: { allMult: 1.5 } },
    { id: 'click_4', name: 'Thousand fingers',          cost: 1.2e6,  desc: 'Each click also earns +3% of your CpS.',req: { clicks: 2500 },    effect: { clickCpsPct: 0.03 } },
    { id: 'all_3',   name: 'Warm ovens',                cost: 2.5e6,  desc: 'All building output x1.5.',             req: { allBaked: 5e6 },     effect: { allMult: 1.5 } },
    { id: 'click_6', name: 'Iron knuckles',             cost: 3e6,    desc: 'Clicking power x3 (stacks).',           req: { clicks: 4000 },    effect: { clickMult: 3 } },
    { id: 'all_1',   name: 'Sugar rush',                cost: 1e7,    desc: 'All building output x1.5.',             req: { totalBuildings: 100 }, effect: { allMult: 1.5 } },
    { id: 'gc_1',    name: 'Shiny golden aura',         cost: 333333, desc: 'Golden cookies appear 25% more often.', req: { goldenClicked: 1 },  effect: { gcInterval: 0.75 } },
    { id: 'gc_2',    name: 'Frenzy fuel',               cost: 2.5e6,  desc: 'Frenzies are x9 instead of x7.',        req: { goldenClicked: 3 },  effect: { frenzyMult: 9 } },
    { id: 'lucky_1', name: 'Lucky charm',               cost: 7.77e6, desc: 'Lucky cookies pay out 50% more.',       req: { goldenClicked: 5 },  effect: { luckyPct: 1.5 } },
    { id: 'offline_1', name: 'Night shift ovens',       cost: 1.2e7,  desc: 'Offline earnings cap raised to 14 hours.', req: { allBaked: 2e7 }, effect: { offlineHours: 14 } }
  );

  // Building-pair synergies (mid-game): double TWO buildings at once.
  UPGRADES.push(
    { id: 'synergy_1', name: 'Grandma on the farm',     cost: 1.2e5, desc: 'Grandmas and farms x2.',          req: { buildings: [{ building: 'grandma', count: 10 }, { building: 'farm', count: 5 }] },       effect: { buildings: ['grandma', 'farm'], value: 2 } },
    { id: 'synergy_4', name: "Cursor's apprentice",     cost: 3e4,   desc: 'Cursors and grandmas x2.',        req: { buildings: [{ building: 'cursor', count: 10 }, { building: 'grandma', count: 10 }] },    effect: { buildings: ['cursor', 'grandma'], value: 2 } },
    { id: 'synergy_5', name: 'Finger farm',             cost: 6e5,   desc: 'Cursors and farms x2.',           req: { buildings: [{ building: 'cursor', count: 25 }, { building: 'farm', count: 25 }] },       effect: { buildings: ['cursor', 'farm'], value: 2 } },
    { id: 'synergy_2', name: 'Industrial baking',       cost: 8e6,   desc: 'Mines and factories x2.',         req: { buildings: [{ building: 'mine', count: 10 }, { building: 'factory', count: 5 }] },        effect: { buildings: ['mine', 'factory'], value: 2 } },
    { id: 'synergy_3', name: 'Cookie logistics',        cost: 4e7,   desc: 'Factories and banks x2.',         req: { buildings: [{ building: 'factory', count: 15 }, { building: 'bank', count: 5 }] },        effect: { buildings: ['factory', 'bank'], value: 2 } },
    { id: 'synergy_6', name: 'Ritual automation',       cost: 1.5e9, desc: 'Temples and wizard towers x2.',   req: { buildings: [{ building: 'temple', count: 10 }, { building: 'wizard', count: 10 }] },     effect: { buildings: ['temple', 'wizard'], value: 2 } },
    { id: 'synergy_7', name: 'Planetary alchemy',       cost: 8e10,  desc: 'Shipments and alchemy labs x2.',  req: { buildings: [{ building: 'shipment', count: 10 }, { building: 'alchemy', count: 10 }] },   effect: { buildings: ['shipment', 'alchemy'], value: 2 } }
  );

  /* ---------------- Heavenly shop (bought with heavenly chips) -------
   * req.hUpgrade : the prerequisite item that must be owned first
   *                (tiered chains — "II"/"III" items unlock step by step).
   * Same-key effects do NOT stack; later tiers simply set a higher value.
   * ------------------------------------------------------------------ */
  const H_UPGRADES = [
    // --- Tier I: the original four blessings --------------------------
    { id: 'h_click',   name: 'Angellic blessing', cost: 3,  desc: '+2 base cookies per click.',            effect: { baseClickAdd: 2 } },
    { id: 'h_cps',     name: 'Heavenly light',    cost: 10, desc: 'All cookie production x1.25.',          effect: { allMult: 1.25 } },
    { id: 'h_gc',      name: 'Lucky halo',        cost: 25, desc: 'Golden cookies appear far more often (interval x0.6).', effect: { gcInterval: 0.6 } },
    { id: 'h_offline', name: 'Eternal patience',  cost: 50, desc: 'Offline earnings last up to 30 hours and pay double.',   effect: { offlineHours: 30, offlineRate: 2 } },

    // --- Click tier chain ---------------------------------------------
    { id: 'h_click2',  name: 'Serenity of touch', cost: 8,  desc: 'Clicking power x2.',                    req: { hUpgrade: 'h_click' }, effect: { clickMult: 2 } },
    { id: 'h_click3',  name: 'Divine fingers',    cost: 20, desc: 'Each click also earns +5% of your CpS.',req: { hUpgrade: 'h_click2' }, effect: { clickCpsPct: 0.05 } },

    // --- Global-production tier chain ----------------------------------
    { id: 'h_cps2',    name: 'Radiant grace',     cost: 30, desc: 'All cookie production x1.5.',           req: { hUpgrade: 'h_cps' },   effect: { allMult: 1.5 } },
    { id: 'h_cps3',    name: 'Eternal radiance',  cost: 80, desc: 'All cookie production x2.',             req: { hUpgrade: 'h_cps2' },  effect: { allMult: 2 } },

    // --- Golden-cookie tier chain --------------------------------------
    { id: 'h_frenzy',  name: 'Divine fervor',     cost: 40, desc: 'Frenzies are x10 and last a full 30 seconds.', req: { hUpgrade: 'h_gc' }, effect: { frenzyMult: 10, frenzyDur: 30000 } },
    { id: 'h_lucky',   name: "Fortune's smile",   cost: 45, desc: 'Lucky cookies pay out x2.5 more.',      req: { hUpgrade: 'h_gc' }, effect: { luckyPct: 2.5 } },

    // --- Offline tier chain ---------------------------------------------
    { id: 'h_offline2',name: 'Ageless ovens',     cost: 100,desc: 'Offline earnings last up to 48 hours and pay triple.', req: { hUpgrade: 'h_offline' }, effect: { offlineHours: 48, offlineRate: 3 } },

    // --- Standalone blessings -------------------------------------------
    { id: 'h_grant',   name: 'Heavenly grant',    cost: 35, desc: 'After ascending you keep 2% of the cookies baked this run.', effect: { keepPct: 0.02 } },
    { id: 'h_cost',    name: 'Bargain heaven',    cost: 60, desc: 'All buildings cost 25% less.',           effect: { buildingCostMult: 0.75 } },
    { id: 'h_ascend',  name: 'Ascendant soul',    cost: 75, desc: '+5% to all cookie production per ascension performed (stacks forever).', effect: { perAscension: 0.05 } },
    { id: 'h_chip',    name: "Angel's favor",     cost: 120,desc: 'Every heavenly chip boosts production by +4% instead of +2%.', effect: { chipBonusAdd: 0.02 } }
  ];

  /* ---------------- Achievements -------------------------------------
   * Each unlocked achievement grants +2% to all production.
   * check(state, ctx) where ctx = { cps(), totalBuildings() }
   * ------------------------------------------------------------------ */
  const ACHIEVEMENTS = [
    // hint = the "how to unlock" line shown on hover.
    { id: 'a_click',     name: 'Get with the program', desc: 'Click the big cookie once.',        hint: 'Click the big cookie on the left. That\u2019s it — one click counts.', check: function (s) { return s.stats.clicks >= 1; } },
    { id: 'a_click100',  name: 'Clicktician',          desc: 'Click the big cookie 100 times.',   hint: 'Keep clicking the big cookie until you reach 100 total clicks (shown in Statistics).', check: function (s) { return s.stats.clicks >= 100; } },
    { id: 'a_click1k',   name: 'Carpal tunnel legend', desc: 'Click the big cookie 1,000 times.', hint: 'Reach 1,000 total big-cookie clicks. Buy click upgrades to keep it fun.', check: function (s) { return s.stats.clicks >= 1000; } },
    { id: 'a_click5k',   name: 'Click maestro',        desc: 'Click the big cookie 5,000 times.', hint: 'Reach 5,000 total big-cookie clicks. Click upgrades keep it interesting this deep in.', check: function (s) { return s.stats.clicks >= 5000; } },
    { id: 'a_bake1',     name: "That's my boy!",       desc: 'Bake a cookie.',                    hint: 'Bake your first cookie — one click, or wait for a building to produce one.', check: function (s) { return s.allBaked >= 1; } },
    { id: 'a_bake100',   name: 'Cookie novice',        desc: 'Bake 100 cookies.',                 hint: 'Bake 100 cookies in total. Clicks plus building output all count, across ascensions.', check: function (s) { return s.allBaked >= 1e2; } },
    { id: 'a_bake1e4',   name: 'Dough lordling',       desc: 'Bake 10,000 cookies.',              hint: 'Bake 10K cookies total. A few buildings and some patience get you here fast.', check: function (s) { return s.allBaked >= 1e4; } },
    { id: 'a_bake1e5',   name: 'Crumb tycoon',         desc: 'Bake 100,000 cookies.',             hint: 'Bake 100K cookies in total. Mid-game territory — your buildings are doing most of the work now.', check: function (s) { return s.allBaked >= 1e5; } },
    { id: 'a_bake1e6',   name: 'Millionaire of crumbs',desc: 'Bake 1 million cookies.',           hint: 'Bake 1M cookies total. Keep buying buildings and upgrades — output compounds.', check: function (s) { return s.allBaked >= 1e6; } },
    { id: 'a_bake1e8',   name: 'Cookie magnate',       desc: 'Bake 100 million cookies.',         hint: 'Bake 100M cookies in total. Synergy upgrades and golden cookies make this go much faster.', check: function (s) { return s.allBaked >= 1e8; } },
    { id: 'a_bake1e9',   name: 'Cookie billionaire',   desc: 'Bake 1 billion cookies.',           hint: 'Bake 1B cookies total. Ascension (Heaven tab) pays out its first heavenly chips at 500M baked in a single run.', check: function (s) { return s.allBaked >= 1e9; } },
    { id: 'a_bake1e12',  name: 'Trillion-touched',     desc: 'Bake 1 trillion cookies.',          hint: 'Bake 1T cookies total. Late-game empire work — heavenly chips and shop items help a lot.', check: function (s) { return s.allBaked >= 1e12; } },
    { id: 'a_cps10',     name: 'Production line',      desc: 'Reach 10 CpS.',                     hint: 'Get your cookies-per-second to 10. Buy buildings (Cursors are +0.1/s each) and upgrades.', check: function (s, c) { return c.cps() >= 10; } },
    { id: 'a_cps100',    name: 'Rolling dough',        desc: 'Reach 100 CpS.',                    hint: 'Get your cookies-per-second to 100. A handful of farms plus a doubling upgrade gets there quickly.', check: function (s, c) { return c.cps() >= 100; } },
    { id: 'a_cps1k',     name: 'Cookie factory floor', desc: 'Reach 1,000 CpS.',                  hint: 'Get your cookies-per-second to 1,000. Mix of many buildings + doubling upgrades.', check: function (s, c) { return c.cps() >= 1e3; } },
    { id: 'a_cps10k',    name: 'Cookie conveyor',      desc: 'Reach 10,000 CpS.',                 hint: 'Get your cookies-per-second to 10K. Mid-game building mix plus the x2 synergy upgrades.', check: function (s, c) { return c.cps() >= 1e4; } },
    { id: 'a_cps1m',     name: 'Cookie singularity',   desc: 'Reach 1 million CpS.',              hint: 'Get your cookies-per-second to 1M. Endgame — heavenly chips (+2% each) and golden cookies help.', check: function (s, c) { return c.cps() >= 1e6; } },
    { id: 'a_build1',    name: "So you're in the game",desc: 'Own your first building.',          hint: 'Buy any building from the store on the right — a Cursor costs just 15 cookies.', check: function (s, c) { return c.totalBuildings() >= 1; } },
    { id: 'a_build10',   name: 'Cookie shopkeeper',    desc: 'Own 10 buildings.',                 hint: 'Own 10 buildings in total — a cursor, a grandma and a couple of farms get you there fast.', check: function (s, c) { return c.totalBuildings() >= 10; } },
    { id: 'a_build50',   name: 'Cookie landlord',      desc: 'Own 50 buildings.',                 hint: 'Own 50 buildings in total. Keep buying — prices scale by x1.15 each purchase.', check: function (s, c) { return c.totalBuildings() >= 50; } },
    { id: 'a_build100',  name: 'Bakery chain',         desc: 'Own 100 buildings.',                hint: 'Own 100 buildings in total. The x10 buy button earns its keep here.', check: function (s, c) { return c.totalBuildings() >= 100; } },
    { id: 'a_build250',  name: 'Industrialist',        desc: 'Own 250 buildings.',                hint: 'Own 250 buildings in total. The x10 buy button helps a lot here.', check: function (s, c) { return c.totalBuildings() >= 250; } },
    { id: 'a_upg10',     name: 'Upgrade enthusiast',   desc: 'Own 10 upgrades in one run.',       hint: 'Buy 10 upgrades before your next ascension. Check the Upgrades tab — the badge counts what you can afford right now.', check: function (s) { return s.upgrades.length >= 10; } },
    { id: 'a_golden1',   name: 'Fortune crumb',        desc: 'Click a golden cookie.',            hint: 'Golden cookies pop up at random (every ~45–120s) and last 13 seconds. Click one!', check: function (s) { return s.stats.goldenClicked >= 1; } },
    { id: 'a_golden10',  name: 'Gold rush',            desc: 'Click 10 golden cookies.',          hint: 'Click 10 golden cookies. They appear randomly — keep an eye out and be quick (13s window).', check: function (s) { return s.stats.goldenClicked >= 10; } },
    { id: 'a_golden25',  name: 'Gilded glove',         desc: 'Click 25 golden cookies.',          hint: 'Click 25 golden cookies lifetime. They pop up every ~45–120s — stay sharp and consider the golden upgrades.', check: function (s) { return s.stats.goldenClicked >= 25; } },
    { id: 'a_frenzy',    name: 'Frenzy state',         desc: 'Be in a frenzy.',                   hint: 'Click a golden cookie — it can trigger Frenzy, multiplying CpS by x7 for 18 seconds.', check: function (s, c) { return c.inFrenzy(); } },
    { id: 'a_frenzy5',   name: 'Frenzy fanatic',       desc: 'Ride out 5 frenzies.',              hint: 'Experience 5 frenzy buffs total (each starts from a lucky golden cookie). The count is tracked in Statistics.', check: function (s) { return s.stats.frenzies >= 5; } },
    { id: 'a_time30m',   name: 'Dough marathon',       desc: 'Play for 30 minutes.',              hint: 'Accumulate 30 total minutes of playtime — see Time played in the Statistics panel.', check: function (s) { return s.stats.playtimeMs >= 30 * 60e3; } },
    { id: 'a_ascend',    name: 'Ascended',             desc: 'Perform an ascension.',             hint: 'Bake 500M cookies this run, open the Heaven tab in the store, and press Ascend. You keep achievements + heavenly shop, gain a permanent production bonus per chip.', check: function (s) { return s.stats.ascensions >= 1; } },
    { id: 'a_ascend2',   name: 'Second heaven',        desc: 'Perform a second ascension.',       hint: 'Ascend twice. After your first ascension, keep baking to 500M cookies this run and ascend again for more chips. The Ascendant soul blessing rewards you for every ascension ever performed.', check: function (s) { return s.stats.ascensions >= 2; } },
    { id: 'a_chips10',   name: 'Chip hoarder',         desc: 'Hold 10 heavenly chips.',           hint: 'Bank 10 heavenly chips from ascensions. Chips are spent in the Heavenly shop — keep some in reserve!', check: function (s) { return s.chips >= 10; } }
  ];

  /* ---------------- News ticker templates ---------------------------- */
  const NEWS_WHO = [
    'A local grandma', 'Your cursor', 'The Cookie Council', 'An anonymous wizard',
    'A suspiciously well-fed farm', 'The Big Cookie itself', 'The bank manager',
    'A time machine operator'
  ];

  const NEWS = [
    'Local baker reports record cookie output: {cps}/s and climbing.',
    '{who} now responsible for most of your CpS. Take a bow.',
    'Economists baffled as cookies appreciate at {cps} per second.',
    'Scientists confirm: the cookies are 100% real. Public relieved.',
    '{who} spotted working overtime. Unions express concern.',
    'Bank interest rates hit all-time high thanks to cookie reserves.',
    'Cookie futures up 42% on strong click volume.',
    'Health officials: eating {cookies} cookies is "technically a lifestyle".',
    'Time machine operator insists they are not stealing cookies from the past.',
    'Portal maintenance crew warns of occasional cookie rain in nearby areas.',
    '{who} demands fair wages in crumbs. Management declines.',
    'Antimatter condenser rated five stars by local food critics.',
    'Prism produces first light-baked cookie; connoisseurs weep openly.',
    'Golden cookies sighted in the wild. Experts advise clicking quickly.'
  ];

  global.CC_DATA = {
    BUILDINGS: BUILDINGS,
    UPGRADES: UPGRADES,
    H_UPGRADES: H_UPGRADES,
    ACHIEVEMENTS: ACHIEVEMENTS,
    NEWS: NEWS,
    NEWS_WHO: NEWS_WHO,

    // Tuning constants (documented in README.md)
    TUNING: {
      COST_GROWTH: 1.15,          // building price growth per unit owned
      ACHIEVEMENT_BONUS: 0.02,    // +2% production per achievement
      CHIP_BONUS: 0.02,           // +2% production per heavenly chip
      GOLDEN_MIN_MS: 45000,       // golden cookie spawn window (min)
      GOLDEN_MAX_MS: 120000,      // golden cookie spawn window (max)
      GOLDEN_LIFE_MS: 13000,      // time a spawned golden cookie stays clickable
      FRENZY_MULT: 7,             // base frenzy multiplier
      FRENZY_DUR_MS: 18000,       // base frenzy duration
      LUCKY_CPS_SECONDS: 600,     // lucky payout = max(13, cps * this)
      OFFLINE_MIN_MS: 60000,      // ignore absences shorter than 1 minute
      OFFLINE_CAP_HOURS: 8,       // default offline earning cap
      ASCEND_DIVISOR: 5e8         // chips = floor((runBaked / divisor)^0.4) — first chip at 500M baked this run
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);

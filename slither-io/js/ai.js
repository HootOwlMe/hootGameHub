// ============================================================
// ai.js — BotBrain: steering decisions for AI snakes
// ============================================================
// Decision pipeline each tick (~8-14Hz per bot, staggered so the herd
// doesn't move in lockstep):
//   1) Wall awareness       → hard peel-off only right at the boundary; a soft
//                             bend when heading INTO it, so bots can graze the
//                             edge for dots like a human would
//   2) Blocked / surrounded → full-circle gap scan; slip through the
//                             widest opening (boost only when the gap is
//                             tight AND we can afford the mass loss)
//   3) Food pursuit         → dead-snake paths are locked on and driven
//                             end-to-end (max pellets per distance); otherwise
//                             density-based: sample a ring of candidate regions,
//                             commit to the densest reachable cluster, work its
//                             centroid, then switch to pellet-by-pellet eating
//                             once inside
//   4) Wander               → smooth sinusoidal drift, calmer when big
// A repulsion field from nearby snake bodies is blended into every
// non-escape decision: the player's body and other snakes' *heads* are
// weighted extra (they're the moving threats), so bots keep a safety
// buffer around snakes instead of hugging them. Boosting is suppressed
// whenever there's a body close ahead — burning mass next to danger is
// how small bots die.

"use strict";

const FOOD_RANGE        = 520;   // max distance at which a bot notices food regions
const CLUSTER_RADIUS    = 150;   // radius used to measure "dot density" of a region
const REGION_PROBE_DIST = 260;   // how far ahead candidate-region samples are placed
const PROGRESS_TIMEOUT  = 2.2;   // s without closing in → abandon target
// Dead-snake paths: a long line of dropped pellets is worth driving end-to-end.
// Detection requires most of the local value to sit in a narrow strip along one
// axis, so random scattered food never triggers it.
const TRAIL_SCAN_R    = 300;   // pickup radius for trail detection
const TRAIL_MIN_VALUE = 28;    // min total pellet value to count as a path
const TRAIL_CORRIDOR  = 38;    // strip half-width for the line fit (detection)
const TRAIL_MIN_LEN   = 180;   // min end-to-end length of the line
const TRAIL_FOLLOW_W  = 48;    // corridor half-width while following
const TRAIL_EXTEND    = 1200;  // how far along a fitted axis we march to find the path's ends
const TRAIL_REACH     = 900;   // how far ahead along the path we scan each tick
// Soft wall zone: bots start bending away from an edge only while heading INTO
// it, so they can graze the boundary for dense corner dots (like a human)
// instead of holding a hard standoff. Bending ramps up as they get closer.
const WALL_SAFE = 480;          // outside this: no wall influence at all
const WALL_PUSH = 230;          // inside this: even parallel travel gets a weak center
// pull, so bots do not camp on the edge

// Blend two heading angles (w ∈ [0,1], 0 = a1, 1 = a2) via vector sum.
function blendAngle(a1, a2, w) {
  const x = Math.cos(a1) * (1 - w) + Math.cos(a2) * w;
  const y = Math.sin(a1) * (1 - w) + Math.sin(a2) * w;
  return Math.atan2(y, x);
}

class BotBrain {
  constructor(snake) {
    this.snake = snake;
    this.decisionTimer = Math.random() * 0.12;
    this.seed = Math.random() * 100;
    // Committed food-target state: a dense region and/or one pellet.
    this.regionCenter = null;     // {x,y} of the committed cluster (drifts to its centroid)
    this.targetPellet = null;     // single-pellet point target while eating up close
    this.bestDist = Infinity;     // smallest distance seen since acquiring it
    this.progressDeadline = 0;    // world.time by which progress must resume
    this.lastAimAngle = null;     // bearing of the last pursued aim (continuity bias)
    this.inEscape = false;        // escape state, with hysteresis (see update)
    this.escapeAngle = null;      // gap we're currently committed to slipping through
    this.cmdAngle = null;         // previous commanded heading (smoothing filter)
    this.trail = null;            // locked-on dead-snake path {dx,dy,ex,ey} — see followTrail
  }

  update(dt, world) {
    this.decisionTimer -= dt;
    if (this.decisionTimer > 0) return;
    this.decisionTimer = 0.08 + Math.random() * 0.06;

    const s = this.snake;
    let boost = false;
    let target = null;
    let escaping = false;

    // ---- 1) Wall awareness: approach freely; peel off only when we can't turn away in time ----
    // The lethal line is r*0.4 inside the edge (main.js), and even a big snake
    // boosting straight into the wall needs ~45-70px to complete a 90° turn —
    // so a hard zone of just ~r*1.3+40 keeps us safe while letting us hug much
    // closer than the old 260px standoff.
    let wallD = Infinity, awayA = null;   // dist to nearest wall + inward normal angle
    {
      const dR = HALF - s.x, dL = s.x + HALF, dB = HALF - s.y, dT = s.y + HALF;
      if (dR <= dL && dR <= dB && dR <= dT)     { wallD = dR; awayA = Math.PI; }          // east wall
      else if (dL <= dB && dL <= dT)            { wallD = dL; awayA = 0; }                 // west wall
      else if (dB <= dT)                        { wallD = dB; awayA = -Math.PI / 2; }     // south wall
      else                                      { wallD = dT; awayA = Math.PI / 2; }       // north wall
      const hardD = s.radius * 1.3 + 40;
      if (wallD < hardD) { target = awayA; boost = false; }   // true emergency: full override
    }

    // ---- Threat scan: forward clearance + repulsion field ----
    const threat = this.scanThreats(s, world);

    // ---- 2) Blocked or surrounded → find the widest gap around us ----
    // Hysteresis: enter escape when it's tight, only leave once there is
    // comfortable room again. Without this the state flickers on/off as we
    // drift near a body, and each flip yanks the heading (waffling).
    {
      const enter = threat.frontClearance < s.radius * 1.9 + 16;
      const exit  = threat.frontClearance > s.radius * 2.6 + 34;
      if (!this.inEscape && enter) this.inEscape = true;
      else if (this.inEscape && exit) this.inEscape = false;
    }
    if (target == null && this.inEscape) {
      const esc = this.findEscape(s, world, threat);
      target = esc.angle;
      boost  = esc.boost;
      escaping = true;
    }

    // ---- 3) Density-based food pursuit ----
    let aimDist = Infinity;
    if (target == null) {
      const res = this.pursueFood(s, world);
      if (res) { target = res.angle; boost = res.boost; aimDist = res.dist; }
    }

    // ---- 4) Wander: smooth sinusoidal drift, calmer when big ----
    if (target == null) {
      const amp = clamp(1.2 / (1 + s.mass * 0.01), 0.3, 1.2);
      target = s.angle + Math.sin(world.time * 0.6 + this.seed) * amp;
    }

    // ---- Safety buffer: bend away from nearby bodies when not escaping ----
    if (!escaping && threat.repelMag > 0.02) {
      const slack = clamp((s.radius * 3 + 80 - threat.frontClearance) / 240, 0, 0.6);
      // Near a committed pellet the food must win: repulsion fades to ~12%
      // so we reach eating range instead of orbiting just outside it.
      const proximity = clamp((aimDist - 20) / 110, 0.12, 1);
      if (slack * proximity > 0.04) {
        target = blendAngle(target, Math.atan2(threat.repelY, threat.repelX), slack * proximity);
      }
    }

    // ---- Soft wall zone: bend away only while heading INTO the wall ----
    // Travel parallel to (or away from) the edge is left untouched so bots can
    // graze the boundary for dots; coming in at an angle curves them off, with
    // strength ramping up as they get closer.
    if (!escaping && target != null && awayA !== null && wallD < WALL_SAFE) {
      const hardD = s.radius * 1.3 + 40;   // below this, escape logic takes over
      // Deliberate corner grazing: chasing food right at the edge weakens the bend —
      // a bot aiming for corner dots always has room to back out (it came from open
      // water), so steering it away would starve it.
      let grazing = false;
      if (this.targetPellet && !this.targetPellet.dead &&
          dist2(s.x, s.y, this.targetPellet.x, this.targetPellet.y) < 170 * 170) grazing = true;
      else if (this.regionCenter) {
        const rc = this.regionCenter;
        const rcWall = Math.min(HALF - rc.x, rc.x + HALF, HALF - rc.y, rc.y + HALF);
        if (rcWall < 170 && dist2(s.x, s.y, rc.x, rc.y) < 340 * 340) grazing = true;
      }
      const toward = -Math.cos(normAngle(s.angle - awayA));   // +1 = straight into the wall
      if (toward > 0.15 && wallD > hardD) {
        const ramp = (WALL_SAFE - wallD) / (WALL_SAFE - hardD);
        let strength = s.mass < 60 ? 0.85 : 0.5;
        if (grazing) strength *= 0.15;  // let it feed; the hard emergency zone is what protects it
        const w = ramp * Math.min(toward, 1) * strength;
        if (w > 0.03) target = blendAngle(target, awayA, Math.min(w, grazing ? 0.25 : 0.75));
      }
      // Very close: even wall-parallel drift gets a nudge back inside (skipped while
      // deliberately feeding on dots at the edge).
      if (!grazing && wallD < WALL_PUSH && wallD > hardD) {
        const ramp = (WALL_PUSH - wallD) / WALL_PUSH;
        target = blendAngle(target, awayA, 0.12 * ramp);
      }
    }

    // ---- Boost gate: never burn mass with a snake right in front of us ----
    if (boost && threat.frontClearance < s.radius * 3 + 60) boost = false;

    // Damp heading JITTER across decisions: small swings (rotating repulsion
    // fields, pellet-to-pellet switching) are low-passed; big intentional
    // turns — new targets, escapes — pass through unfiltered so the bot
    // stays decisive when it matters.
    {
      const base = this.cmdAngle === null ? s.angle : this.cmdAngle;
      let da = normAngle(target - base);
      if (Math.abs(da) <= 1.2) target = base + da * 0.55;   // jitter band
      this.cmdAngle = target;
    }

    // Anti-waffle: commands may swing at most ~150° per decision in escape
    // mode and ~115° otherwise, so a probe/gap flip can't yank the heading
    // into an instant reversal while fast escapes stay possible.
    {
      const maxStep = escaping ? 2.6 : 2.0;
      const da = normAngle(target - s.angle);
      if (Math.abs(da) > maxStep) target = s.angle + Math.sign(da) * maxStep;
    }

    s.steer(target);
    s.setBoost(boost);
  }

  // ---------- Threat awareness ------------------------------------------
  // One pass over nearby snake bodies →
  //   frontClearance: worst (head-to-segment margin) across forward probes.
  //                    Small/negative means "blocked". Infinity = clear.
  //   repelX/repelY : ~1/d repulsion field from everything close by, so a
  //                    smooth blend can nudge any desired heading aside.

  scanThreats(s, world) {
    const res = { frontClearance: Infinity, repelX: 0, repelY: 0, repelMag: 0 };
    const out = [];

    // Forward clearance probes (3 distances × 3 lateral offsets).
    for (const d of [70, 140, 210]) {
      for (const off of [0, 0.5, -0.5]) {
        const a = s.angle + off;
        const px = s.x + Math.cos(a) * d, py = s.y + Math.sin(a) * d;
        world.segGrid.query(px, py, s.radius + 18, out);
        for (const e of out) {
          if (e.snake === s || !e.snake.alive) continue;
          // Extra margin vs the player: we're wariest of a human trying to trap us.
          const margin = e.r + s.radius * 0.75 + (e.snake.isPlayer ? 14 : 6);
          const clear = Math.sqrt(dist2(px, py, e.x, e.y)) - margin;
          if (clear < res.frontClearance) res.frontClearance = clear;
        }
        out.length = 0;
      }
    }

    // Repulsion field from every nearby segment.
    const R = Math.max(100, 60 + s.radius * 2.5);
    const reach2 = R * R * 0.81;
    world.segGrid.query(s.x, s.y, R, out);
    for (const e of out) {
      if (e.snake === s || !e.snake.alive) continue;
      const dx = s.x - e.x, dy = s.y - e.y;
      const d2v = dx * dx + dy * dy;
      if (d2v > reach2 || d2v < 1) continue;
      let w = 1 / Math.sqrt(d2v);
      if (e.snake.isPlayer) w *= 1.5;   // extra wary of the player
      // Leading segments are moving threats — they can close on us fast.
      if (dist2(e.x, e.y, e.snake.x, e.snake.y) < SEG_SPACING * SEG_SPACING * 9) w *= 1.4;
      res.repelX += dx * w;
      res.repelY += dy * w;
    }
    out.length = 0;

    res.repelMag = Math.hypot(res.repelX, res.repelY);
    return res;
  }

  // ---------- Escape: blocked or surrounded ------------------------------
  // Two-stage gap selection. Stage 1 sweeps a full circle (12 rays × 2
  // sample points) and finds the WIDEST opening — clearance dominates,
  // because when you're boxed in, alignment bonuses must never win over
  // "is there actually space here". Stage 2 then picks the most convenient
  // ray among those within a few px of the best (dots ahead, less turning,
  // pointing back toward center near walls).
  findEscape(s, world, threat) {
    const K = 12;
    const rays = [];
    let bestClear = -Infinity;
    const out = [];

    for (let k = 0; k < K; k++) {
      // Slight per-bot jitter so a herd doesn't all pick the same gap.
      const a = s.angle + (k / K) * Math.PI * 2 + Math.sin(this.seed * 5.1 + k * 2.3) * 0.18;

      let clearance = Infinity;
      for (const d of [60, 125]) {
        const px = s.x + Math.cos(a) * d, py = s.y + Math.sin(a) * d;
        world.segGrid.query(px, py, s.radius + 14, out);
        for (const e of out) {
          if (e.snake === s || !e.snake.alive) continue;
          const margin = e.r + s.radius * 0.8 + (e.snake.isPlayer ? 12 : 4);
          const clear = Math.sqrt(dist2(px, py, e.x, e.y)) - margin;
          if (clear < clearance) clearance = clear;
        }
        out.length = 0;
      }

      // Dots in that direction make a gap more attractive.
      let foodVal = 0;
      const fx = s.x + Math.cos(a) * 170, fy = s.y + Math.sin(a) * 170;
      world.food.grid.query(fx, fy, CLUSTER_RADIUS * 0.8, out);
      for (const q of out) if (!q.dead) foodVal += q.value;
      out.length = 0;

      rays.push({ a, clearance, foodVal });
      if (clearance > bestClear) bestClear = clearance;
    }

    // Stage 2. Two regimes:
    //   • A genuinely open ray exists (clearance > 0): pick the most convenient
    //     among passable ones (dots ahead, less turning, center-pointing).
    //   • Trapped — every ray is blocked: momentum/alignment bonuses must NOT
    //     win; commit strictly to the widest gap and drive through it.
    const wallD = Math.min(HALF - s.x, HALF + s.x, HALF - s.y, HALF + s.y);
    const centerA = Math.atan2(-s.y, -s.x);
    // Continuity: once we've picked a gap, keep steering toward it while it
    // stays passable — otherwise adjacent near-equal gaps make the heading
    // flip-flop between decisions (waffling).
    const contBonus = (a) => this.escapeAngle === null ? 0 : Math.max(0, Math.cos(normAngle(a - this.escapeAngle))) * 40;

    let best = null, bestScore = -Infinity;
    if (bestClear > 0) {
      for (const r of rays) {
        if (r.clearance < bestClear - 8) continue;   // not a real opening
        const align = 1 - Math.abs(normAngle(r.a - s.angle)) / Math.PI;
        let score = align * 45 + r.foodVal * 0.6 + contBonus(r.a);
        if (wallD < 340) {
          score += (1 - Math.abs(normAngle(r.a - centerA)) / Math.PI) * 50;
        }
        if (score > bestScore) { bestScore = score; best = r; }
      }
      if (!best) best = rays[0];
    } else {
      // Trapped: clearance first. When the repulsion field is active it
      // points away from the surrounding walls — use -repel as a tiebreak so
      // we push OUTWARD through the widest gap instead of circling inside.
      const rm = threat ? threat.repelMag : 0;
      let hasRepel = false, rx = 0, ry = 0;
      if (threat && rm > 0.02) { rx = -threat.repelX / rm; ry = -threat.repelY / rm; hasRepel = true; }
      for (const r of rays) {
        const dot = hasRepel ? Math.cos(r.a) * rx + Math.sin(r.a) * ry : 0;
        // Continuity matters less when truly boxed in — clearance rules.
        const score = r.clearance * 3 + dot * 4 + contBonus(r.a) * 0.15;
        if (score > bestScore) { bestScore = score; best = r; }
      }
    }
    this.escapeAngle = best.a;

    // Boost only through genuinely tight gaps, and only when we can afford it.
    const boost = best.clearance < s.radius + 16 && s.mass > MIN_BOOST_MASS + 14;
    return { angle: best.a, boost };
  }

  // ---------- Density-based food pursuit ---------------------------------
  // A bot commits to a *region* (a dense cluster of pellets) rather than a
  // single dot. It steers toward the region's live centroid, and once inside
  // it switches to pellet-by-pellet eating. Regions are dropped when they're
  // worked dry so bots re-scan and move on with the herd.

  pursueFood(s, world) {
    // Dead-snake path lock: once committed to a line of pellets, drive it
    // end-to-end before anything else gets considered.
    if (this.trail) {
      const t = this.followTrail(s, world);
      if (t) return t;
      this.trail = null;   // exhausted or lost → normal pursuit below
    }

    let p = this.targetPellet;

    // Drop a stale point target: eaten by someone else, or drifted out of range.
    if (p && (p.dead || dist2(s.x, s.y, p.x, p.y) > FOOD_RANGE * FOOD_RANGE)) p = null;

    // Resolve / maintain a committed region.
    let rc = this.regionCenter;
    if (rc) {
      const c = this.regionCentroid(rc.x, rc.y, world);
      if (!c) {
        rc = null;   // worked dry → re-scan next tick
      } else {
        rc.x = c.x; rc.y = c.y;
        if (dist2(s.x, s.y, c.x, c.y) < 90 * 90) {
          p = this.nearestPellet(c.x, c.y, CLUSTER_RADIUS, world);
          rc = null;   // inside the cluster → fine-grained eating
        }
      }
      this.regionCenter = rc;
    }

    if (!p && !rc) {
      const aq = this.acquireFoodTarget(s, world);
      if (aq.trail) {                    // the scan found a long path → lock on
        const t = this.followTrail(s, world);
        if (t) return t;
        this.trail = null;
      }
      p  = aq.pellet;
      rc = aq.region;
      this.targetPellet = p;
      this.regionCenter = rc;
      const aim0 = rc || (p ? { x: p.x, y: p.y } : null);
      if (!aim0) return null;   // nothing worth eating → wander
      this.bestDist = Math.sqrt(dist2(s.x, s.y, aim0.x, aim0.y));
      this.progressDeadline = world.time + PROGRESS_TIMEOUT;
    }

    const aim = rc || p;
    const d = Math.sqrt(dist2(s.x, s.y, aim.x, aim.y));
    this.lastAimAngle = Math.atan2(aim.y - s.y, aim.x - s.x);

    // Progress tracking. Only real closing (≥ 3px) counts as progress;
    // otherwise the deadline runs out and we abandon the target — that's
    // the self-rescue for bots deflected into a circle around it.
    if (d < this.bestDist - 3) {
      this.bestDist = d;
      this.progressDeadline = world.time + PROGRESS_TIMEOUT;
    } else if (world.time > this.progressDeadline) {
      this.targetPellet = null;
      this.regionCenter = null;
      this.bestDist = Infinity;
      return null;   // wander for a bit, then re-pick
    }

    let boost = false;
    if (rc && d > 200 && s.mass > 18 && Math.random() < 0.3) boost = true;

    if (p) {
      // Very close: keep heading straight so momentum carries us over the
      // pellet — we're already inside tryEat's reach, so going straight
      // through is what actually eats it.
      if (d < s.radius + 12) {
        return { angle: s.angle, boost: false, dist: d };
      }
      if (!rc && d > 180 && s.mass > 18 && Math.random() < 0.45) boost = true;
    }

    return { angle: Math.atan2(aim.y - s.y, aim.x - s.x), boost, dist: d };
  }

  // Scan the neighborhood and commit to the densest reachable food region,
  // or to a single nearby pellet if nothing better is around.
  acquireFoodTarget(s, world) {
    const out = [];

    // What's already around our head? (Staying put must be able to win.)
    let localVal = 0;
    let nearest = null, nearestD2 = Infinity;
    world.food.grid.query(s.x, s.y, CLUSTER_RADIUS, out);
    for (const q of out) {
      if (q.dead) continue;
      const d2 = dist2(s.x, s.y, q.x, q.y);
      localVal += q.value;
      if (d2 < nearestD2) { nearestD2 = d2; nearest = q; }
    }

    // Sample candidate regions in a ring around us and score each by its
    // total pellet value, penalized by how far we'd have to turn.
    const K = 12;
    let bestScore = -Infinity, bestV = 0, bestX = 0, bestY = 0;
    const probePts = [];   // scored ring samples, reused for trail fitting
    for (let k = 0; k < K; k++) {
      // Slight per-bot jitter → the herd spreads across nearby clusters.
      const a = s.angle + (k / K) * Math.PI * 2 + Math.sin(this.seed * 3.7 + k) * 0.25;
      const px = s.x + Math.cos(a) * REGION_PROBE_DIST;
      const py = s.y + Math.sin(a) * REGION_PROBE_DIST;
      let v = 0;
      world.food.grid.query(px, py, CLUSTER_RADIUS, out);
      for (const q of out) {
        if (!q.dead && dist2(px, py, q.x, q.y) < CLUSTER_RADIUS * CLUSTER_RADIUS) v += q.value;
      }
      const turn = Math.abs(normAngle(a - s.angle));
      let score = v / (1 + 1.3 * turn / Math.PI);
      // Continuity bonus: keep going roughly where we were headed, so two
      // near-equal clusters can't make us ping-pong between them.
      if (this.lastAimAngle !== null) {
        const c = Math.cos(normAngle(a - this.lastAimAngle));
        if (c > 0) score *= 1 + 0.5 * c;
      }
      probePts.push({ x: px, y: py, score });
      if (score > bestScore) { bestScore = score; bestV = v; bestX = px; bestY = py; }
    }
    out.length = 0;

    // A long dead-snake path beats any region score. Check right around our
    // head first, then at the richest probed patches — a line seen from afar
    // is a thin sliver inside one probe window, so it must be fitted there.
    if (this.tryAcquireTrail(s.x, s.y, world, s.x, s.y)) {
      return { pellet: null, region: null, trail: true };
    }
    // A thin sliver scores poorly against round blobs of random food, so the
    // score order only sets priority — every probe gets a line fit (each fit
    // bails early on the cheap stage-1 gate when there's no line).
    probePts.sort((a, b) => b.score - a.score);
    for (let i = 0; i < probePts.length; i++) {
      if (this.tryAcquireTrail(probePts[i].x, probePts[i].y, world, s.x, s.y)) {
        return { pellet: null, region: null, trail: true };
      }
    }

    // Travel only for a clearly richer patch than what's already around us.
    // Sitting on decent food must beat "maybe 20% better over there" —
    // otherwise the herd scatters and nobody eats efficiently. In a truly
    // empty neighborhood, drop the bar: any real patch out there is worth
    // hunting (matches the old single-pellet acquisition reach).
    if (localVal < 8 ? bestV >= 12 : bestV >= Math.max(24, localVal * 1.8)) {
      return { pellet: null, region: { x: bestX, y: bestY } };
    }
    if (nearest) return { pellet: nearest, region: null };
    return { pellet: null, region: null };
  }

  // Centroid of live pellets in a committed region; null when worked dry.
  regionCentroid(cx, cy, world) {
    const out = [];
    let sx = 0, sy = 0, sv = 0;
    world.food.grid.query(cx, cy, CLUSTER_RADIUS, out);
    for (const q of out) {
      if (q.dead) continue;
      if (dist2(cx, cy, q.x, q.y) > CLUSTER_RADIUS * CLUSTER_RADIUS) continue;
      sx += q.x * q.value; sy += q.y * q.value; sv += q.value;
    }
    out.length = 0;
    return sv >= 10 ? { x: sx / sv, y: sy / sv } : null;
  }

  // ---------- Dead-snake path (trail) following --------------------------
  // A dead snake leaves a long line of high-value pellets. Fitting that line
  // lets us lock on and drive it end-to-end — maximizing pellets eaten per
  // distance — instead of hopping pellet-by-pellet and drifting off to some
  // other cluster halfway down the path.

  // Value-weighted line fit around probe point (x,y). On success sets
  // this.trail with the axis unit vector (dx,dy) pointing from the NEAR end
  // toward the far one, plus that near entry point (ex,ey). "Near" is judged
  // relative to the SNAKE HEAD (hx,hy), not the probe — a probe can land on
  // the far side of the line's middle and would otherwise invert the axis.
  tryAcquireTrail(x, y, world, hx, hy) {
    const out = [];
    const pts = [];
    world.food.grid.query(x, y, TRAIL_SCAN_R, out);
    for (const q of out) if (!q.dead) pts.push(q);
    out.length = 0;

    let sv = 0, cx = 0, cy = 0;
    for (const q of pts) { sv += q.value; cx += q.x * q.value; cy += q.y * q.value; }
    if (sv < 10 || pts.length < 4) return false;
    cx /= sv; cy /= sv;

    // Principal axis via the value-weighted 2×2 covariance eigenvector.
    let Sxx = 0, Syy = 0, Sxy = 0;
    for (const q of pts) {
      const w = q.value, dxp = q.x - cx, dyp = q.y - cy;
      Sxx += w * dxp * dxp; Syy += w * dyp * dyp; Sxy += w * dxp * dyp;
    }
    if (Sxx + Syy < 1e-6) return false;   // degenerate — all value at one point
    const th = 0.5 * Math.atan2(2 * Sxy, Sxx - Syy);
    let ax = Math.cos(th), ay = Math.sin(th);

    // Stage 1: keep only the value that already sits in a narrow strip along
    // the axis — that's the line; everything else is background food. Random
    // scattered food fails this (a strip of that width holds only a trickle).
    const onLine = [];
    let svL = 0, uMin = Infinity, uMax = -Infinity;
    for (const q of pts) {
      const dxp = q.x - cx, dyp = q.y - cy;
      if (Math.abs(-ax * dyp + ay * dxp) > TRAIL_CORRIDOR) continue;   // background
      onLine.push(q);
      svL += q.value;
      const u = dxp * ax + dyp * ay;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
    }
    if (svL < 14 || (uMax - uMin) < 80 || onLine.length < 3) return false;

    // Refit the axis over the line-only set — background-free, so it's tight.
    let cx2 = 0, cy2 = 0;
    for (const q of onLine) { cx2 += q.x * q.value; cy2 += q.y * q.value; }
    cx2 /= svL; cy2 /= svL;
    Sxx = 0; Syy = 0; Sxy = 0;
    for (const q of onLine) {
      const w = q.value, dxp = q.x - cx2, dyp = q.y - cy2;
      Sxx += w * dxp * dxp; Syy += w * dyp * dyp; Sxy += w * dxp * dyp;
    }
    if (Sxx + Syy > 1e-6) {
      const th2 = 0.5 * Math.atan2(2 * Sxy, Sxx - Syy);
      ax = Math.cos(th2); ay = Math.sin(th2);
    }

    // Stage 2: march along the refined axis to find the path's true extent —
    // seeing one end of a long drop-line is enough to claim the whole thing.
    const all = onLine.slice();
    const seen = new Set(onLine);
    for (const sgn of [1, -1]) {
      for (let d = 240; d <= TRAIL_EXTEND; d += 240) {
        world.food.grid.query(cx2 + ax * sgn * d, cy2 + ay * sgn * d, 65, out);
        let added = false;
        for (const q of out) {
          if (q.dead || seen.has(q)) continue;
          const dxp = q.x - cx2, dyp = q.y - cy2;
          if (Math.abs(-ax * dyp + ay * dxp) > 40) continue;   // off the line
          seen.add(q); all.push(q); added = true;
        }
        out.length = 0;
        if (!added) break;   // corridor ran dry → reached an end
      }
    }

    let svE = 0, uMinE = Infinity, uMaxE = -Infinity, stripE = 0;
    for (const q of all) {
      const dxp = q.x - cx2, dyp = q.y - cy2;
      const u = dxp * ax + dyp * ay;
      svE += q.value;
      if (u < uMinE) uMinE = u;
      if (u > uMaxE) uMaxE = u;
      if (Math.abs(-ax * dyp + ay * dxp) <= TRAIL_CORRIDOR) stripE += q.value;
    }
    if (svE < TRAIL_MIN_VALUE || (uMaxE - uMinE) < TRAIL_MIN_LEN || stripE / svE < 0.65) return false;

    // Enter at the near end and drive toward the far one.
    const uc = ((hx !== undefined ? hx : x) - cx2) * ax + ((hy !== undefined ? hy : y) - cy2) * ay;
    let dx, dy, ex, ey;
    if (Math.abs(uMinE - uc) <= Math.abs(uMaxE - uc)) {
      dx = ax;  dy = ay;  ex = cx2 + ax * uMinE; ey = cy2 + ay * uMinE;
    } else {
      dx = -ax; dy = -ay; ex = cx2 + ax * uMaxE; ey = cy2 + ay * uMaxE;
    }
    this.trail = { dx, dy, ex, ey, flipped: false };
    return true;
  }

  // Steer along the committed path. Returns a command, or null when the path
  // is exhausted / lost (caller drops trail state and falls back).
  followTrail(s, world) {
    const t = this.trail;
    const out = [];

    // Where is our head relative to the line? (axis through the entry end)
    const hx = s.x - t.ex, hy = s.y - t.ey;
    const uH   = hx * t.dx + hy * t.dy;         // position along the axis
    const perp = Math.abs(-t.dx * hy + t.dy * hx);  // distance off the line

    if (uH < 20 || perp > TRAIL_FOLLOW_W) {
      // Approach / realign: drive to a point on the line just ahead of us.
      // Covers both the initial approach from afar and drifting back on after
      // a deflection — the corridor below only works once we're ON the line.
      const aliveAt = (px, py) => {
        world.food.grid.query(px, py, 90, out);
        let v = 0;
        for (const q of out) if (!q.dead) v += q.value;
        out.length = 0;
        return v >= 8;
      };
      let tu = Math.max(uH, 0) + 60;
      let tx = t.ex + t.dx * tu, ty = t.ey + t.dy * tu;
      if (!aliveAt(tx, ty)) {
        // Dead end ahead: the axis may be oriented backwards — reorient
        // toward live food on the other side before giving up.
        const tu2 = Math.max(-uH, 0) + 60;
        const tx2 = t.ex - t.dx * tu2, ty2 = t.ey - t.dy * tu2;
        if (!aliveAt(tx2, ty2)) return null;   // path is gone
        t.dx = -t.dx; t.dy = -t.dy;
        tx = tx2; ty = ty2;                    // target already in the new frame
      }
      const d = Math.sqrt(dist2(s.x, s.y, tx, ty));
      const boost = d > 420 && s.mass > 18 && Math.random() < 0.5;
      return { angle: Math.atan2(ty - s.y, tx - s.x), boost, dist: d };
    }

    // On the line: corridor scan ahead (and a bit behind).
    let sv = 0, behindV = 0;
    let bestP = null, bestU = Infinity;   // nearest pellet on/just ahead
    const seen = new Set();
    for (let u = -140; u <= TRAIL_REACH; u += 90) {
      world.food.grid.query(s.x + t.dx * u, s.y + t.dy * u, 70, out);
      for (const q of out) {
        if (q.dead || seen.has(q)) continue;
        seen.add(q);
        const dxp = q.x - s.x, dyp = q.y - s.y;
        if (Math.abs(-t.dx * dyp + t.dy * dxp) > TRAIL_FOLLOW_W) continue;  // off the line
        const uu = dxp * t.dx + dyp * t.dy;
        if (uu < -30) { behindV += q.value; continue; }   // already passed
        sv += q.value;
        if (uu < bestU) { bestU = uu; bestP = q; }
      }
    }
    out.length = 0;

    if (sv < 6) {
      // Nothing left this way: turn around for the far side, else done.
      if (behindV >= 12 && !t.flipped) {
        t.flipped = true; t.dx = -t.dx; t.dy = -t.dy;
        return this.followTrail(s, world);   // one re-scan in the new direction
      }
      return null;
    }

    const d = Math.sqrt(dist2(s.x, s.y, bestP.x, bestP.y));
    // Chase the NEXT pellet on the path — aiming at a far end lets turn-damping
    // drift us off the line; hugging each pellet keeps us glued to it, and
    // everything behind is eaten as we pass. We only give up at an empty run.
    const boost = d > 260 && s.mass > 18 && Math.random() < 0.5;
    return { angle: Math.atan2(bestP.y - s.y, bestP.x - s.x), boost, dist: d };
  }

  // Nearest live pellet to (cx,cy) within r.
  nearestPellet(cx, cy, r, world) {
    const out = [];
    let best = null, bd2 = Infinity;
    world.food.grid.query(cx, cy, r, out);
    for (const q of out) {
      if (q.dead) continue;
      const d2 = dist2(cx, cy, q.x, q.y);
      if (d2 < bd2) { bd2 = d2; best = q; }
    }
    out.length = 0;
    return best;
  }
}


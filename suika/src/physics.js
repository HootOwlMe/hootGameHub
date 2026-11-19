/* ============================================================
 * physics.js — circle-only rigid body world for the Suika clone
 *
 * Design notes:
 *  - Fixed timestep is owned by main.js; this World just steps.
 *  - Each step runs N substeps (small dt) and, inside each
 *    substep, M Gauss-Seidel iterations over all contacts so that
 *    stacks of up to ~40 circles settle without jitter or sinking.
 *  - Restitution is velocity-dependent: slow contacts use e = 0
 *    which kills the classic "stack buzz" in circle games.
 *  - Positional correction uses Baumgarte percent + slop, applied
 *    inside the iteration loop for rock-solid stacks.
 * ============================================================ */

'use strict';

var PHYS = {
  gravity: 1650,        // px/s^2 (soft, floaty fall)
  substeps: 6,          // physics substeps per frame-step (1/60s)
  iterations: 9,        // velocity-impulse iterations per substep
  posIterations: 8,     // dedicated position-correction passes per substep
  restitution: 0.10,    // bounciness for fast impacts
  restSpeed: 90,        // px/s — below this approach speed, e = 0
  friction: 0.08,       // Coulomb-style tangent coefficient (pair) — low so that fruit rolls
  wallRestitution: 0.14,
  slop: 0.5,            // allowed penetration before correction (px)
                         // NOTE: resting contacts sit at ~this gap, so the
                         // merge tolerance in main.js must be BELOW it
  percent: 0.30,        // fraction of penetration corrected per position pass
  maxSpeed: 2400,       // px/s clamp — prevents tunneling at dt/6
  floorFriction: 0.9985  // horizontal damping while resting on the floor (per substep)
};

/** A circular body. Game data (tier, tilt, ...) is attached by main.js. */
function Body(x, y, r) {
  this.id = (Body._nextId = (Body._nextId || 0) + 1); // stable id for contact bookkeeping
  this.x = x;
  this.y = y;
  this.r = r;
  this.vx = 0;
  this.vy = 0;
  // mass ~ area so big fruits are heavy like in the real game
  var m = r * r * 0.01;
  this.invMass = 1 / m;

  // per-substep contact flag (used for settling + danger detection)
  this.touch = false;
}

Body.prototype.speed = function () {
  return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
};

/**
 * @param {number} left   inner x of the left wall
 * @param {number} right  inner x of the right wall
 * @param {number} bottom inner y of the floor
 */
function World(left, right, bottom) {
  this.left = left;
  this.right = right;
  this.bottom = bottom;
  this.bodies = [];
  /** Largest approach speed (px/s) seen during the last step — for SFX. */
  this.lastImpact = 0;
  /** Deepest contact per pair DURING this step (key → {p: penPx, x,y: tangential
   *  velocity of b relative to a at that moment}). Fast side-impacts are separated
   *  by the solver before frame end, so merge detection in main.js consults this
   *  to catch collisions that already bounced apart — and uses (x,y) to carry a
   *  share of the impact's sliding momentum into the merged fruit. */
  this.contactPen = new Map();
}

World.prototype.add = function (b) { this.bodies.push(b); };

World.prototype.remove = function (b) {
  var i = this.bodies.indexOf(b);
  if (i >= 0) this.bodies.splice(i, 1);
};

/** Advance the simulation by dt seconds. */
World.prototype.step = function (dt) {
  var h = dt / PHYS.substeps;
  this.lastImpact = 0;
  this.contactPen.clear();

  for (var s = 0; s < PHYS.substeps; s++) {
    var bs = this.bodies;

    // reset contact flags
    for (var i = 0; i < bs.length; i++) bs[i].touch = false;

    // --- integrate -------------------------------------------------
    for (i = 0; i < bs.length; i++) {
      var b = bs[i];
      b.vy += PHYS.gravity * h;
      // a whisper of air drag keeps things calm
      b.vx *= 0.999;
      b.vy *= 0.999;
      b.floorTouch = false; // reset per substep (set by wall velocity solve)

      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (sp > PHYS.maxSpeed) {
        var k = PHYS.maxSpeed / sp;
        b.vx *= k; b.vy *= k;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
    }

    // --- velocity phase: impulses only, no position changes ---------
    //     (interleaving positional correction here stiffens deep piles
    //      and pumps energy — keep the phases separate, like Box2D)
    for (var it = 0; it < PHYS.iterations; it++) {
      for (i = 0; i < bs.length; i++) {
        for (var j = i + 1; j < bs.length; j++) {
          this.solvePairVelocity(bs[i], bs[j]);
        }
      }
      for (i = 0; i < bs.length; i++) this.solveWallVelocity(bs[i]);
    }

    // --- position phase: de-penetrate, then re-clamp to walls --------
    for (it = 0; it < PHYS.posIterations; it++) {
      for (i = 0; i < bs.length; i++) {
        for (j = i + 1; j < bs.length; j++) {
          this.solvePairPosition(bs[i], bs[j]);
        }
      }
      for (i = 0; i < bs.length; i++) this.clampToWalls(bs[i]);
    }

    // floor rolling friction — ONCE per substep. (solveWallVelocity runs
    // inside the iteration loop, so damping there would be applied ~9x too often)
    for (i = 0; i < bs.length; i++) {
      if (bs[i].floorTouch) bs[i].vx *= PHYS.floorFriction;
    }

    // --- sleep-assist: kill micro-jitter of slow, supported bodies --
    for (i = 0; i < bs.length; i++) {
      var c = bs[i];
      // (gentle — must not brake a genuine slow roll)
      if (c.touch && Math.sqrt(c.vx * c.vx + c.vy * c.vy) < 10) {
        c.vx *= 0.96;
        c.vy *= 0.96;
      }
    }
  }
};

/** Velocity impulse + friction for one circle-circle contact. */
World.prototype.solvePairVelocity = function (a, b) {
  var rs = a.r + b.r;
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return;

  var d = Math.sqrt(d2);
  if (d < 1e-6) { d = 1e-6; dx = 1e-6; dy = 0; } // degenerate: nudge apart along +x
  var nx = dx / d;
  var ny = dy / d;

  a.touch = true;
  b.touch = true;

  // --- velocity impulse --------------------------------------------
  var iM = a.invMass + b.invMass;
  var rvx = a.vx - b.vx;
  var rvy = a.vy - b.vy;
  var rvn = rvx * nx + rvy * ny; // >0 means approaching along n (a→b)
  if (rvn <= 0) return;

  var e = rvn < PHYS.restSpeed ? 0 : PHYS.restitution;
  var jImp = (1 + e) * rvn / iM;
  a.vx -= jImp * a.invMass * nx;
  a.vy -= jImp * a.invMass * ny;
  b.vx += jImp * b.invMass * nx;
  b.vy += jImp * b.invMass * ny;

  if (rvn > this.lastImpact) this.lastImpact = rvn;

  // --- Coulomb friction (clamped tangential impulse) ----------------
  var tx = -ny, ty = nx;
  var rvt = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty; // >0: a slides along +t̂

  // track deepest overlap seen so far this frame (+ the tangential slide at
  // that moment — merge detection & momentum transfer in main.js use both)
  var pen = rs - d;
  var key = a.id < b.id ? a.id * 1048576 + b.id : b.id * 1048576 + a.id;
  var prevHit = this.contactPen.get(key);
  if (prevHit === undefined || pen > prevHit.p) {
    // tangential velocity of b relative to a, as a vector: ((b−a)·t̂) · t̂
    this.contactPen.set(key, { p: pen, x: -rvt * tx, y: -rvt * ty });
  }
  var jt = -rvt / iM;
  var maxF = jImp * PHYS.friction;
  if (jt > maxF) jt = maxF;
  else if (jt < -maxF) jt = -maxF;
  // a gets +J·t̂, b gets −J·t̂ with J = jt (<0 when a slides along +t̂),
  // so each body is pushed opposite its relative slip — true friction
  a.vx += jt * a.invMass * tx;
  a.vy += jt * a.invMass * ty;
  b.vx -= jt * b.invMass * tx;
  b.vy -= jt * b.invMass * ty;
};

/** Positional de-penetration for one circle-circle contact. */
World.prototype.solvePairPosition = function (a, b) {
  var rs = a.r + b.r;
  var dx = b.x - a.x;
  var dy = b.y - a.y;
  var d2 = dx * dx + dy * dy;
  if (d2 >= rs * rs) return;

  var d = Math.sqrt(d2);
  if (d < 1e-6) { d = 1e-6; dx = 1e-6; dy = 0; }
  var nx = dx / d;
  var ny = dy / d;

  a.touch = true;
  b.touch = true;

  var iM = a.invMass + b.invMass;
  var pen = rs - d;
  var corr = Math.max(pen - PHYS.slop, 0) * PHYS.percent / iM;
  if (corr <= 0) return;
  a.x -= corr * a.invMass * nx;
  a.y -= corr * a.invMass * ny;
  b.x += corr * b.invMass * nx;
  b.y += corr * b.invMass * ny;
};

/** Hard-clamp one body back inside the walls (position only). */
World.prototype.clampToWalls = function (b) {
  var r = b.r;
  if (b.y + r > this.bottom) { b.y = this.bottom - r; b.touch = true; }
  if (b.x - r < this.left)   { b.x = this.left + r;   b.touch = true; }
  if (b.x + r > this.right)  { b.x = this.right - r;  b.touch = true; }
};

/** Velocity reflection/friction for one body against the three walls. */
World.prototype.solveWallVelocity = function (b) {
  var r = b.r;

  // floor
  if (b.y + r >= this.bottom - PHYS.slop) {
    if (b.vy > 0) {
      if (b.vy > this.lastImpact) this.lastImpact = b.vy;
      b.vy = -b.vy * (b.vy < PHYS.restSpeed ? 0 : PHYS.wallRestitution);
    }
    b.floorTouch = true;
    b.touch = true;
  }

  // left wall
  if (b.x - r <= this.left + PHYS.slop) {
    if (b.vx < 0) {
      var v = -b.vx;
      if (v > this.lastImpact) this.lastImpact = v;
      b.vx = -b.vx * (v < PHYS.restSpeed ? 0 : PHYS.wallRestitution);
    }
    b.touch = true;
  }

  // right wall
  if (b.x + r >= this.right - PHYS.slop) {
    if (b.vx > 0) {
      var v2 = b.vx;
      if (v2 > this.lastImpact) this.lastImpact = v2;
      b.vx = -b.vx * (v2 < PHYS.restSpeed ? 0 : PHYS.wallRestitution);
    }
    b.touch = true;
  }
};

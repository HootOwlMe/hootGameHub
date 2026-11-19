/* ============================================================
 * main.js — game loop, input, merging, FX and rendering
 * Depends on: physics.js (Body, World), fruits.js (FRUITS...),
 * audio.js (SFX). Plain scripts, no modules → works from file://.
 * ============================================================ */

'use strict';

/* ---------- small helpers ----------------------------------- */
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* ---------- board geometry (logical pixels) ----------------- */
var W = 420, H = 640;
var L = 20, R = 400, TOP = 20, BOTTOM = 620;   // inner well rect
var DANGER_Y = 95;                             // red overflow line
var DROP_Y = 64;                               // fixed drop height (spawn line)
var DROP_COOLDOWN = 0.45;                      // seconds between drops
var mergesEnabled = true;                      // console: mergesEnabled = false to pause merging
var STEP = 1 / 60;

/* ---------- DOM --------------------------------------------- */
var canvas = document.getElementById('game');
var ctx = canvas.getContext('2d');
var splash = document.getElementById('splash');
var nextCanvas = document.getElementById('nextCanvas');
var nctx = nextCanvas ? nextCanvas.getContext('2d') : null;
var scoreEl = document.getElementById('score');
var bestEl = document.getElementById('best');
var overlay = document.getElementById('overlay');
var overlayTitle = document.getElementById('overlayTitle');
var overlaySubtitle = document.getElementById('overlaySubtitle');
var overlayScoreWrap = document.querySelector('.overlay-score');
var overlayScore = document.getElementById('overlayScore');
var btnPlayAgain = document.getElementById('btnPlayAgain');

/* ---------- state ------------------------------------------- */
var world = null;
var mode = 'splash';               // splash | playing | paused | over
var score = 0, best = 0, displayScore = 0, lastScoreText = '', lastBestText = '';
var combo = 0, lastMergeTime = -99;
var lastDropTime = -99;
var drag = null;                   // {tier,x,y,rot,valid} while dragging (y pinned to DROP_Y)
var hover = { x: W / 2, inside: false }; // cursor position for the always-on drop indicator
var spawnQueue = [pickSpawnTier(), pickSpawnTier()]; // [current piece, next piece]
var particles = [], floaters = [], rings = [];
var shakeT = 0, shakeDur = 1, shakeMag = 0;
var shakeOn = true; // screen-shake preference (persisted)
try { shakeOn = localStorage.getItem('suika-shake') !== '0'; } catch (e) {}
var dangerTimer = 0, multiTimer = 0;
var clock = 0;                     // gameplay time (merges/combo timing)
var visTime = 0;                   // visual time (pulses, pop animations)
var lastThud = -9;
var overlayAction = 'restart';

/* ---------- canvas sizing ------------------------------------ */
function fitCanvas() {
  var dpr = Math.min(2.5, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (nextCanvas) {
    nextCanvas.width = 48 * dpr;
    nextCanvas.height = 48 * dpr;
  }
}

/** Draw the "next fruit" chip in the HUD. */
function drawNextPreview() {
  if (!nctx) return;
  var dpr = Math.min(2.5, window.devicePixelRatio || 1);
  nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  nctx.clearRect(0, 0, 48, 48);
  var f = FRUITS[spawnQueue[1]];
  var s = 20 / f.r; // scale to fit the 48px chip (largest spawnable r=28)
  nctx.save();
  nctx.translate(24, 25);
  nctx.scale(s, s);
  f.draw(nctx, f.r);
  nctx.restore();
}

/* ---------- persistence -------------------------------------- */
function loadBest() {
  try { return parseInt(localStorage.getItem('suika-best') || '0', 10) || 0; } catch (e) { return 0; }
}
function saveBest() {
  try { localStorage.setItem('suika-best', String(best)); } catch (e) {}
}

/* ---------- game flow ---------------------------------------- */
function startGame() {
  world = new World(L, R, BOTTOM);
  score = 0; displayScore = 0; lastScoreText = '';
  combo = 0; lastMergeTime = -99; lastDropTime = -99;
  particles.length = 0; floaters.length = 0; rings.length = 0;
  shakeT = 0; dangerTimer = 0; multiTimer = 0; drag = null; clock = 0;
  spawnQueue[0] = pickSpawnTier();
  spawnQueue[1] = pickSpawnTier();
  drawNextPreview();
  mode = 'playing';
  SFX.startMusic(); // starts the chiptune loop ONCE; no-op while it plays, so restarts never gap or double up
  if (splash) splash.classList.add('hidden');
  overlay.classList.add('hidden');
}

function endGame() {
  mode = 'over';
  drag = null;
  canvas.classList.remove('dragging');
  // NOTE: the music loop intentionally keeps playing through game over —
  // restart is decoupled from it entirely (no stop, no re-start).
  SFX.gameOver();
  showOverlay('Game Over', 'The well overflowed!', score, 'Play Again', 'restart');
}

function togglePause() {
  if (mode === 'playing') {
    mode = 'paused';
    drag = null;
    canvas.classList.remove('dragging');
    showOverlay('Paused', 'Take a breath \u{1F349}', null, 'Resume', 'resume');
    swapPauseIcon(true);
  } else if (mode === 'paused') {
    mode = 'playing';
    overlay.classList.add('hidden');
    swapPauseIcon(false);
  }
}

function showOverlay(title, sub, finalScore, btnLabel, action) {
  overlayTitle.textContent = title;
  overlaySubtitle.textContent = sub;
  if (finalScore == null) {
    overlayScoreWrap.style.display = 'none';
  } else {
    overlayScoreWrap.style.display = '';
    overlayScore.textContent = finalScore;
  }
  btnPlayAgain.textContent = btnLabel;
  overlayAction = action;
  overlay.classList.remove('hidden');
}

/* ---------- score & HUD -------------------------------------- */
function addScore(pts, x, y) {
  score += pts;
  if (score > best) { best = score; saveBest(); }
  addFloater(x, y, '+' + pts, '#5b4a2f', Math.min(30, 16 + pts * 0.15));
}

function updateHud() {
  var s = String(Math.round(displayScore));
  if (s !== lastScoreText) { scoreEl.textContent = s; lastScoreText = s; }
  var b = String(best);
  if (b !== lastBestText) { bestEl.textContent = b; lastBestText = b; }
}

/* ---------- merging ------------------------------------------ */
/** Visual radius: physics circle plus half the outline stroke width. */
function visRadius(r) {
  return r + Math.max(1.5, r * 0.07) / 2;
}

function handleMerges() {
  if (!mergesEnabled) return;
  for (var pass = 0; pass < 12; pass++) {
    var bs = world.bodies;
    var pairs = [], used = {};
    for (var i = 0; i < bs.length; i++) {
      if (used[i]) continue;
      for (var j = i + 1; j < bs.length; j++) {
        if (used[j] || bs[j].tier !== bs[i].tier) continue;
        var dx = bs[i].x - bs[j].x, dy = bs[i].y - bs[j].y;
        // resting contacts sit at ~PHYS.slop (0.5px) penetration, so the
        // merge tolerance must be BELOW that — contact means merge, as in Suika.
        // Also count overlap seen ANYWHERE this frame: a fast side-impact is
        // separated by the solver before frame end, without this it would roll off
        var key = bs[i].id < bs[j].id ? bs[i].id * 1048576 + bs[j].id : bs[j].id * 1048576 + bs[i].id;
        var hit = world.contactPen.get(key);
        // count the drawn border as part of each fruit's radius, so fruits
        // merge when their VISIBLE edges touch (outline extends r by lw/2)
        var pen = Math.max(visRadius(bs[i].r) + visRadius(bs[j].r) - Math.sqrt(dx * dx + dy * dy), hit ? hit.p : 0);
        if (pen > 0.35) { pairs.push([i, j]); used[i] = 1; used[j] = 1; break; }
      }
    }
    if (!pairs.length) return;
    for (var p = 0; p < pairs.length; p++) mergePair(bs[pairs[p][0]], bs[pairs[p][1]]);
  }
}

function mergePair(a, b) {
  var ma = 1 / a.invMass, mb = 1 / b.invMass, m = ma + mb;
  var x = (a.x * ma + b.x * mb) / m;
  var y = Math.min(a.y, b.y);

  // combo & score timing — shared by both merge kinds
  combo = (clock - lastMergeTime < 1.5) ? combo + 1 : 1;
  lastMergeTime = clock;

  if (a.tier === FRUITS.length - 1) {
    // two watermelons: nothing bigger exists, so they VANISH — no new fruit,
    // just a flat +5000 jackpot and a big celebration.
    world.remove(a);
    world.remove(b);
    addScore(5000, x, y);
    spawnBurst(x, y, '#2e7d32', 9);
    spawnBurst(x, y, '#ffffff', 9);
    addRing(x, y, a.r * 0.6, a.r * 3.0, '#ffffff');
    addFloater(W / 2, H * 0.42, 'MELON JACKPOT +5000!', '#2e7d32', 38);
    if (combo >= 2) addFloater(x, y - a.r - 16, 'COMBO x' + combo, '#ff9f1c', Math.min(30, 18 + combo));
    addShake(24, 0.55);
    SFX.fanfare();
    return;
  }

  var tier = a.tier + 1;
  var f = FRUITS[tier];
  x = clamp(x, L + f.r + 1, R - f.r - 1);

  var nb = new Body(x, y, f.r);
  // carry a share of the tangential slide at impact into the merged fruit,
  // so a fruit that skids along its partner's flank keeps rolling that way
  var hKey = a.id < b.id ? a.id * 1048576 + b.id : b.id * 1048576 + a.id;
  var hitC = world.contactPen.get(hKey);
  // 1/3-strength transfer: a gentle nudge in the slide direction, not a shove
  var tvx = hitC ? Math.max(-600, Math.min(600, (hitC.x * 0.55) / 3)) : 0;
  var tvy = hitC ? Math.max(-300, Math.min(300, (hitC.y * 0.25) / 3)) : 0;
  nb.vx = (a.vx * ma + b.vx * mb) / m + tvx + (Math.random() - 0.5) * 14;
  nb.vy = (a.vy * ma + b.vy * mb) / m + tvy - 26;   // small pop out of the pile
  nb.tier = tier;
  var ma = a.r * a.r, mb = b.r * b.r, mm = ma + mb;
  nb.rot = ((a.rot || 0) * ma + (b.rot || 0) * mb) / mm + (Math.random() - 0.5) * 0.06;
  nb.born = visTime;
  world.add(nb);
  world.remove(a);
  world.remove(b);

  var pts = MERGE_SCORE[tier] * combo;
  addScore(pts, x, y - f.r * 0.3);

  // FX
  spawnBurst(x, y, f.color, tier);
  if (tier >= 6) addRing(x, y, f.r * 0.5, f.r * 2.1, f.color);
  if (combo >= 2) addFloater(x, y - f.r - 16, 'COMBO x' + combo, '#ff9f1c', Math.min(30, 18 + combo));
  addShake(Math.min(3 + tier * 1.6, 15), 0.32);

  if (tier === FRUITS.length - 1) {
    SFX.fanfare();
    addFloater(W / 2, H * 0.42, 'WATERMELON!', '#2e7d32', 36);
    addRing(x, y, f.r * 0.6, f.r * 2.8, '#ffffff');
    addShake(20, 0.5);
  } else {
    SFX.merge(tier);
  }
}

/* ---------- FX spawners --------------------------------------- */
function spawnBurst(x, y, color, tier) {
  var n = Math.min(34, 10 + tier * 3);
  for (var i = 0; i < n; i++) {
    var ang = Math.random() * TAU;
    var sp = 60 + Math.random() * (150 + tier * 12);
    particles.push({
      x: x, y: y,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
      r: 2 + Math.random() * (3 + tier * 0.25),
      color: Math.random() < 0.7 ? color : '#ffffff',
      t: 0, life: 0.45 + Math.random() * 0.4
    });
  }
}

function addRing(x, y, r0, r1, color) { rings.push({ x: x, y: y, r0: r0, r1: r1, color: color, t: 0, life: 0.5 }); }
function addFloater(x, y, text, color, size) { floaters.push({ x: clampX(text, x), y: y, text: text, color: color, size: size || 18, t: 0, life: 0.95 }); }
function addShake(mag, dur) {
  if (!shakeOn) return;
  shakeMag = Math.max(shakeMag * (shakeT / shakeDur), mag);
  shakeDur = dur;
  shakeT = Math.max(shakeT, dur);
}

function clampX(text, x) {
  var half = text.length * 7;
  return clamp(x, L + half, R - half);
}

/* ---------- simulation step (fixed dt) ------------------------ */
function update(dt) {
  clock += dt;
  world.step(dt);

  // visual rolling: rotate fruit by its horizontal travel (no-slip kinematics)
  var rbs = world.bodies;
  for (var ri = 0; ri < rbs.length; ri++) {
    var rb = rbs[ri];
    rb.rot = (rb.rot || 0) + rb.vx * dt / rb.r;
  }

  // impact sound (rate-limited)
  var imp = world.lastImpact;
  if (imp > 430 && clock - lastThud > 0.09) {
    lastThud = clock;
    SFX.thud(Math.min(1, (imp - 430) / 900));
  }

  handleMerges();

  // overflow detection — pure duration gate, no velocity check. A fruit only
  // ends the game by STAYING above the red line: both timers accumulate while
  // bodies' TOP edges are at/above DANGER_Y and decay fast when they aren't,
  // so a fruit in transit can never reach threshold (a drop crosses the zone
  // in ≤ ~0.4s even for a watermelon, vs 0.6s / 0.18s gates). Two tiers of
  // confidence:
  //   • 2+ fruits above the line → unambiguous overflow, short persistence gate
  //   • exactly one fruit above the line → longer grace window.
  var inZone = 0;
  for (var i = 0; i < world.bodies.length; i++) {
    if (world.bodies[i].y - world.bodies[i].r <= DANGER_Y) inZone++;
  }
  if (inZone >= 2) multiTimer += dt;
  else multiTimer = Math.max(0, multiTimer - dt * 4);
  if (inZone === 1) dangerTimer += dt;
  else dangerTimer = Math.max(0, dangerTimer - dt * 2);
  if (multiTimer > 1.0 || dangerTimer > 2.0) endGame();

  // combo expiry
  if (clock - lastMergeTime > 1.5) combo = 0;
}

/* ---------- FX update (runs in every mode except paused) ------ */
function updateFx(dt) {
  visTime += dt;
  var i, k;
  for (i = particles.length - 1; i >= 0; i--) {
    var p = particles[i];
    p.t += dt;
    if (p.t > p.life) { particles.splice(i, 1); continue; }
    p.vy += 750 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (i = floaters.length - 1; i >= 0; i--) {
    var f = floaters[i];
    f.t += dt;
    if (f.t > f.life) floaters.splice(i, 1);
  }
  for (i = rings.length - 1; i >= 0; i--) {
    var r = rings[i];
    r.t += dt;
    if (r.t > r.life) rings.splice(i, 1);
  }
  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

  // animated score counter
  displayScore += (score - displayScore) * Math.min(1, dt * 9);
  if (Math.abs(score - displayScore) < 0.6) displayScore = score;
}

/* ---------- rendering ----------------------------------------- */
function roundedRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function render() {
  // static underlay (hides canvas edges while the scene shakes)
  ctx.fillStyle = '#e9c39b';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  if (shakeT > 0) {
    var k = shakeT / shakeDur;
    ctx.translate((Math.random() * 2 - 1) * shakeMag * k, (Math.random() * 2 - 1) * shakeMag * k);
  }

  drawWell();
  if (world && mode !== 'splash') {
    drawBodies();
    drawRingsAndParticles();
    drawFloaters();
    if (mode === 'playing') {
      if (drag) drawGhost(drag);
      else if (hover.inside) drawGhost(makeGhostAt(hover.x)); // indicator follows the cursor at all times
      else drawHoverPiece();
    }
  }
  ctx.restore();
}

function drawWell() {
  // frame
  var fg = ctx.createLinearGradient(0, 0, 0, H);
  fg.addColorStop(0, '#f8d5b2');
  fg.addColorStop(1, '#edbd92');
  ctx.fillStyle = fg;
  ctx.fillRect(-12, -12, W + 24, H + 24);

  // inner well
  var wg = ctx.createLinearGradient(0, TOP, 0, BOTTOM);
  wg.addColorStop(0, '#fffdf6');
  wg.addColorStop(1, '#f3e8d3');
  roundedRect(L, TOP, R - L, BOTTOM - TOP, 14);
  ctx.fillStyle = wg;
  ctx.fill();

  // inner shadows (top + sides) for depth
  var sh = ctx.createLinearGradient(0, TOP, 0, TOP + 30);
  sh.addColorStop(0, 'rgba(90,65,25,0.18)');
  sh.addColorStop(1, 'rgba(90,65,25,0)');
  ctx.save();
  roundedRect(L, TOP, R - L, BOTTOM - TOP, 14);
  ctx.clip();
  ctx.fillStyle = sh;
  ctx.fillRect(L, TOP, R - L, 30);
  sh = ctx.createLinearGradient(L, 0, L + 14, 0);
  sh.addColorStop(0, 'rgba(90,65,25,0.10)');
  sh.addColorStop(1, 'rgba(90,65,25,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(L, TOP, 14, BOTTOM - TOP);
  sh = ctx.createLinearGradient(R, 0, R - 14, 0);
  sh.addColorStop(0, 'rgba(90,65,25,0.10)');
  sh.addColorStop(1, 'rgba(90,65,25,0)');
  ctx.fillStyle = sh;
  ctx.fillRect(R - 14, TOP, 14, BOTTOM - TOP);

  // danger line (pulses while overflow is imminent)
  var a = dangerTimer > 0 ? 0.55 + 0.35 * Math.sin(visTime * 12) : 0.6;
  ctx.strokeStyle = 'rgba(255,70,90,' + a.toFixed(3) + ')';
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(L + 4, DANGER_Y);
  ctx.lineTo(R - 4, DANGER_Y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawBodies() {
  var i, b;
  // contact shadows (only near the floor)
  for (i = 0; i < world.bodies.length; i++) {
    b = world.bodies[i];
    var hGap = BOTTOM - (b.y + b.r);
    if (hGap > 42) continue;
    var sa = 0.22 * (1 - hGap / 42);
    ctx.fillStyle = 'rgba(80,55,20,' + sa.toFixed(3) + ')';
    ctx.beginPath();
    ctx.ellipse(b.x, BOTTOM - 5, b.r * 0.9, b.r * 0.2, 0, 0, TAU);
    ctx.fill();
  }
  // fruits
  for (i = 0; i < world.bodies.length; i++) {
    b = world.bodies[i];
    var f = FRUITS[b.tier];
    var age = visTime - (b.born || 0);
    var s = 1 + 0.28 * Math.max(0, 1 - age / 0.16); // spawn pop
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot || 0);
    ctx.scale(s, s);
    f.draw(ctx, b.r);
    ctx.restore();
  }
}

function drawRingsAndParticles() {
  var i;
  for (i = 0; i < rings.length; i++) {
    var r = rings[i];
    var k = r.t / r.life;
    var e = 1 - (1 - k) * (1 - k); // ease-out
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3 + 7 * (1 - k);
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, 0, TAU);
    ctx.stroke();
  }
  for (i = 0; i < particles.length; i++) {
    var p = particles[i];
    k = p.t / p.life;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(0.5, p.r * (1 - 0.5 * k)), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawFloaters() {
  for (var i = 0; i < floaters.length; i++) {
    var f = floaters[i];
    var k = f.t / f.life;
    ctx.globalAlpha = 1 - k * k;
    ctx.font = '800 ' + f.size + 'px "Baloo 2", "Nunito", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    var y = f.y - k * 34;
    ctx.strokeText(f.text, f.x, y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, y);
  }
  ctx.globalAlpha = 1;
}

function drawGhost(g) {
  var f = FRUITS[g.tier];

  // aim guide
  if (g.y + f.r > TOP) {
    ctx.save();
    roundedRect(L, TOP, R - L, BOTTOM - TOP, 14);
    ctx.clip();
    ctx.strokeStyle = g.valid ? 'rgba(90,80,60,0.25)' : 'rgba(220,60,70,0.35)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(g.x, g.y + f.r + 4);
    ctx.lineTo(g.x, BOTTOM - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // the fruit itself
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.translate(g.x, g.y);
  ctx.rotate(g.rot || 0);
  f.draw(ctx, f.r);
  ctx.restore();

  // invalid indicator
  if (!g.valid) {
    ctx.fillStyle = 'rgba(255,64,80,0.30)';
    ctx.beginPath();
    ctx.arc(g.x, g.y, f.r + 2, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,64,80,' + (0.6 + 0.3 * Math.sin(visTime * 10)).toFixed(3) + ')';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(g.x, g.y, f.r + 6, 0, TAU);
    ctx.stroke();
  }
}

/* ---------- input --------------------------------------------- */
function toLocal(e) {
  var rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width * W,
    y: (e.clientY - rect.top) / rect.height * H
  };
}

/** The next piece hovers at the drop line between drops. */
function drawHoverPiece() {
  var f = FRUITS[spawnQueue[0]];
  var y = DROP_Y + Math.sin(visTime * 2.4) * 3;
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.translate(W / 2, y);
  ctx.rotate(Math.sin(visTime * 1.6) * 0.07);
  f.draw(ctx, f.r);
  ctx.restore();
}

function clampGhost(g) {
  var f = FRUITS[g.tier];
  g.x = clamp(g.x, L + f.r + 1, R - f.r - 1);
  g.y = DROP_Y; // fixed drop height — aim is horizontal only
}

/** Build an aim ghost at x on the spawn line (shared by hover + drag). */
function makeGhostAt(x) {
  var g = { tier: spawnQueue[0], x: x, y: DROP_Y, rot: 0, valid: true };
  clampGhost(g);
  g.valid = dropValid(g);
  return g;
}

/** Suika placement rule: may not be dropped into the pile —
 *  overlapping a fruit whose center is lower (or level) is invalid. */
function dropValid(g) {
  var f = FRUITS[g.tier];
  for (var i = 0; i < world.bodies.length; i++) {
    var b = world.bodies[i];
    var dx = g.x - b.x, dy = g.y - b.y;
    var rr = f.r + b.r - 1.5;
    if (dx * dx + dy * dy < rr * rr && g.y > b.y - 1) return false;
  }
  return true;
}

canvas.addEventListener('pointerdown', function (e) {
  if (mode !== 'playing') return;
  e.preventDefault();
  SFX.ensure();
  var p = toLocal(e);
  hover.x = p.x; hover.inside = true;
  drag = makeGhostAt(p.x);
  drag.rot = (Math.random() - 0.5) * 0.24;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', function (e) {
  var p = toLocal(e);
  hover.x = p.x; hover.inside = true; // track the cursor even when not holding
  if (!drag || mode !== 'playing') return;
  drag.x = p.x; // y stays pinned at DROP_Y
  clampGhost(drag);
  drag.valid = dropValid(drag);
});

canvas.addEventListener('pointerleave', function () { hover.inside = false; });

function endDrag() {
  if (!drag) return;
  canvas.classList.remove('dragging');
  var g = drag;
  drag = null;
  if (mode !== 'playing') return;
  if (!g.valid) { SFX.denied(); return; }
  if (clock - lastDropTime < DROP_COOLDOWN) { SFX.denied(); return; } // short cooldown between drops
  var f = FRUITS[g.tier];
  var b = new Body(g.x, g.y, f.r);
  b.tier = g.tier;
  b.rot = g.rot;
  b.born = visTime;
  world.add(b);
  lastDropTime = clock;
  SFX.spawn();
  // advance the spawn queue and refresh the "next" preview
  spawnQueue.shift();
  spawnQueue.push(pickSpawnTier());
  drawNextPreview();
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', function () { drag = null; hover.inside = false; canvas.classList.remove('dragging'); });
canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

/* ---------- keyboard & buttons --------------------------------- */
var PAUSE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>';
var PLAY_ICON = '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M8 5l11 7-11 7z"/></svg>';

function swapPauseIcon(paused) {
  document.getElementById('btnPause').innerHTML = paused ? PLAY_ICON : PAUSE_ICON;
}

window.addEventListener('keydown', function (e) {
  var k = e.key.toLowerCase();
  if (k === 'p') togglePause();
  else if (k === 'r' && mode !== 'splash') { SFX.restartJingle(); startGame(); } // jingle only — music loop untouched
  else if (k === 's' || k === 'm') refreshSoundIcon(SFX.cycleSound());
  else if ((k === ' ' || k === 'enter')) {
    if (mode === 'splash') { SFX.ensure(); startGame(); }
    else if (mode === 'over') startGame();
    else if (mode === 'paused') togglePause();
  }
});

document.getElementById('btnStart').addEventListener('click', function () {
  SFX.ensure();
  startGame();
});

btnPlayAgain.addEventListener('click', function () {
  SFX.ensure();
  if (overlayAction === 'resume') togglePause();
  else { SFX.restartJingle(); startGame(); }
});

document.getElementById('btnRestart').addEventListener('click', function () {
  if (mode !== 'splash') { SFX.restartJingle(); startGame(); } // jingle only — music loop untouched
});

document.getElementById('btnPause').addEventListener('click', function () {
  SFX.ensure();
  togglePause();
});

var btnSound = document.getElementById('btnSound');
function refreshSoundIcon(mode) { // 0 = on · 1 = music muted · 2 = all muted
  mode = (mode == null) ? SFX.soundMode : mode;
  document.getElementById('soundIconOn').style.display = mode === 0 ? '' : 'none';
  document.getElementById('soundIconMusicOff').style.display = mode === 1 ? '' : 'none';
  document.getElementById('soundIconOff').style.display = mode === 2 ? '' : 'none';
  btnSound.title = ['Sound on (S)', 'Mute music only (S)', 'All sound muted (S)'][mode];
}
btnSound.addEventListener('click', function () {
  SFX.ensure();
  refreshSoundIcon(SFX.cycleSound());
});

var btnShake = document.getElementById('btnShake');
function refreshShakeIcon() {
  document.getElementById('shakeIconOn').style.display = shakeOn ? '' : 'none';
  document.getElementById('shakeIconOff').style.display = shakeOn ? 'none' : '';
}
refreshShakeIcon();
btnShake.addEventListener('click', function () {
  shakeOn = !shakeOn;
  try { localStorage.setItem('suika-shake', shakeOn ? '1' : '0'); } catch (e) {}
  refreshShakeIcon();
});

window.addEventListener('blur', function () {
  if (mode === 'playing') togglePause();
});

/* ---------- main loop ------------------------------------------ */
var last = performance.now(), acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  var dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (mode === 'playing') {
    acc += dt;
    while (acc >= STEP && mode === 'playing') { update(STEP); acc -= STEP; }
  } else {
    acc = 0;
  }
  if (mode !== 'paused') updateFx(dt);

  render();
  updateHud();
}

/* ---------- boot ------------------------------------------------- */
best = loadBest();
SFX.loadSoundPref();
SFX.bindAutoResume(); // keep audio alive across mobile focus loss (iOS suspends the AudioContext)
refreshSoundIcon();
fitCanvas();
drawNextPreview();
window.addEventListener('resize', fitCanvas);
requestAnimationFrame(frame);

/* ============================================================
 * fruits.js — fruit definitions + canvas art
 *
 * Each fruit is a tier 0..9. draw(ctx, r) renders the fruit
 * centered at the origin with radius r. Everything is drawn in
 * vector style (radial gradients + outlines) so it stays crisp
 * at any scale and needs no image assets.
 * ============================================================ */

'use strict';

var TAU = Math.PI * 2;

/* ---------- small drawing helpers -------------------------- */

function radialGrad(ctx, r, cx, cy, stops) {
  var g = ctx.createRadialGradient(r * (cx || -0.35), r * (cy || -0.4), r * 0.12, 0, 0, r);
  for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
  return g;
}

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x || 0, y || 0, r, 0, TAU);
}

/** Soft top-left specular highlight. */
function gloss(ctx, r, strength) {
  ctx.save();
  ctx.globalAlpha = 0.5 * (strength == null ? 1 : strength);
  var g = ctx.createRadialGradient(-r * 0.38, -r * 0.45, 0, -r * 0.38, -r * 0.45, r * 0.62);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
  ctx.restore();
}

/** Darker rim at the bottom for volume. */
function rimShade(ctx, r, strength) {
  ctx.save();
  ctx.globalAlpha = 0.35 * (strength == null ? 1 : strength);
  var g = ctx.createRadialGradient(r * 0.25, r * 0.45, r * 0.2, r * 0.25, r * 0.45, r * 1.15);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  circle(ctx, 0, 0, r);
  ctx.fill();
  ctx.restore();
}

function outline(ctx, r, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width || Math.max(1.5, r * 0.07);
  circle(ctx, 0, 0, r);
  ctx.stroke();
}

/* ---------- individual fruits ------------------------------ */

function drawCherry(ctx, r) {
  // stem
  ctx.strokeStyle = '#5b3a1e';
  ctx.lineWidth = Math.max(1.4, r * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(r * 0.12, -r * 0.72);
  ctx.quadraticCurveTo(r * 0.55, -r * 1.35, r * 0.95, -r * 1.18);
  ctx.stroke();
  // body
  ctx.fillStyle = radialGrad(ctx, r, -0.35, -0.4, [
    [0, '#ff7d92'], [0.55, '#f03856'], [1, '#c21e3e']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r);
  gloss(ctx, r, 0.9);
  outline(ctx, r, 'rgba(120,10,35,0.85)');
}

function drawStrawberry(ctx, r) {
  // body — full circle so the art fills the whole disc (no clear gap to the outline)
  ctx.fillStyle = radialGrad(ctx, r, -0.3, -0.42, [
    [0, '#ff8f9e'], [0.5, '#ef4763'], [1, '#c9184a']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r);
  gloss(ctx, r, 0.7);
  // seeds
  ctx.fillStyle = 'rgba(255,235,150,0.95)';
  var seeds = [[-0.4, -0.15], [0.4, -0.15], [0, 0.15], [-0.5, 0.28], [0.5, 0.28],
    [-0.22, 0.55], [0.22, 0.55], [0, -0.45]];
  for (var i = 0; i < seeds.length; i++) {
    ctx.beginPath();
    ctx.ellipse(seeds[i][0] * r, seeds[i][1] * r, r * 0.07, r * 0.1, 0, 0, TAU);
    ctx.fill();
  }
  // leaf crown (kept inside the circle so nothing pokes past the rim)
  ctx.fillStyle = '#43aa2e';
  for (var k = -1; k <= 1; k++) {
    var tipX = (k === 0 ? 0 : k * r * 0.62);
    var tipY = (k === 0 ? -r * 0.7 : -r * 0.68);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.45);
    ctx.quadraticCurveTo(k * r * 0.55, -r * 0.8, tipX, tipY);
    ctx.closePath();
    ctx.fill();
  }
  outline(ctx, r, 'rgba(120,8,40,0.75)');
}

function drawKiwi(ctx, r) {
  // fuzzy brown body
  ctx.fillStyle = radialGrad(ctx, r, -0.35, -0.4, [
    [0, '#b98a5a'], [0.6, '#8d6239'], [1, '#6b4526']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r);
  // fuzz hint: tiny arcs around the rim
  ctx.strokeStyle = 'rgba(255,235,200,0.28)';
  ctx.lineWidth = Math.max(1, r * 0.05);
  for (var a = 0; a < TAU; a += 0.42) {
    var x0 = Math.cos(a) * r * 0.98, y0 = Math.sin(a) * r * 0.98;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(Math.cos(a) * r * 1.06, Math.sin(a) * r * 1.06);
    ctx.stroke();
  }
  gloss(ctx, r, 0.5);
  outline(ctx, r, 'rgba(70,42,18,0.9)');
}

function drawOrange(ctx, r) {
  ctx.fillStyle = radialGrad(ctx, r, -0.35, -0.4, [
    [0, '#ffd166'], [0.55, '#ff9f1c'], [1, '#e76f00']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r);
  // dimple texture
  ctx.fillStyle = 'rgba(200,90,0,0.25)';
  for (var i = 0; i < 7; i++) {
    var ang = i * 1.7 + 0.6, rr = r * (0.3 + 0.45 * ((i * 37) % 10) / 10);
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, r * 0.05, 0, TAU);
    ctx.fill();
  }
  gloss(ctx, r, 0.7);
  outline(ctx, r, 'rgba(180,80,0,0.8)');
  // leaf + nub on TOP of the border
  ctx.fillStyle = '#43aa2e';
  ctx.beginPath();
  ctx.ellipse(r * 0.18, -r * 0.95, r * 0.3, r * 0.16, -0.5, 0, TAU);
  ctx.fill();
}

function drawApple(ctx, r) {
  ctx.fillStyle = radialGrad(ctx, r, -0.35, -0.4, [
    [0, '#ff9d97'], [0.5, '#ef233c'], [1, '#b8162f']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r);
  gloss(ctx, r, 0.85);
  outline(ctx, r, 'rgba(120,8,25,0.8)');
  // stem + leaf on TOP of the border
  ctx.strokeStyle = '#5b3a1e';
  ctx.lineWidth = Math.max(1.5, r * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.78);
  ctx.quadraticCurveTo(r * 0.08, -r * 1.15, r * 0.22, -r * 1.18);
  ctx.stroke();
  // leaf
  ctx.fillStyle = '#43aa2e';
  ctx.beginPath();
  ctx.ellipse(r * 0.42, -r * 0.95, r * 0.3, r * 0.17, 0.6, 0, TAU);
  ctx.fill();
}

function drawPear(ctx, r) {
  // light green backing so no white shows around the narrow neck
  ctx.fillStyle = '#d7e896';
  circle(ctx, 0, 0, r * 0.97); ctx.fill();
  // pear silhouette: narrow top, bulbous bottom
  ctx.fillStyle = radialGrad(ctx, r * 1.05, -0.3, -0.2, [
    [0, '#e9f5a3'], [0.55, '#b5cc2e'], [1, '#7f9c14']
  ]);
  ctx.beginPath();
  ctx.moveTo(0, -r * 1.0);
  ctx.bezierCurveTo(r * 0.38, -r * 0.95, r * 0.42, -r * 0.35, r * 0.72, 0);
  ctx.bezierCurveTo(r * 1.0, r * 0.45, r * 0.62, r * 1.0, 0, r * 1.0);
  ctx.bezierCurveTo(-r * 0.62, r * 1.0, -r * 1.0, r * 0.45, -r * 0.72, 0);
  ctx.bezierCurveTo(-r * 0.42, -r * 0.35, -r * 0.38, -r * 0.95, 0, -r * 1.0);
  ctx.fill();
  rimShade(ctx, r * 0.95);
  // stem
  ctx.strokeStyle = '#5b3a1e';
  ctx.lineWidth = Math.max(1.4, r * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.92);
  ctx.quadraticCurveTo(r * 0.05, -r * 1.3, r * 0.16, -r * 1.34);
  ctx.stroke();
  gloss(ctx, r * 0.85, 0.75);
}

function drawMelon(ctx, r) {
  // cantaloupe: netted tan-green sphere
  ctx.fillStyle = radialGrad(ctx, r, -0.35, -0.4, [
    [0, '#cdeaa0'], [0.55, '#9ccf6b'], [1, '#6fa84a']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r);
  // net pattern: curved grid clipped to the sphere
  ctx.save();
  circle(ctx, 0, 0, r * 0.985); ctx.clip();
  ctx.strokeStyle = 'rgba(70,110,45,0.5)';
  ctx.lineWidth = Math.max(1, r * 0.035);
  var n = 5;
  for (var i = -n; i <= n; i++) {
    // vertical-ish arcs
    ctx.beginPath();
    ctx.moveTo(i * r * 0.24, -r);
    ctx.quadraticCurveTo(i * r * 0.34, 0, i * r * 0.24, r);
    ctx.stroke();
    // horizontal-ish arcs
    ctx.beginPath();
    ctx.moveTo(-r, i * r * 0.24);
    ctx.quadraticCurveTo(0, i * r * 0.34, r, i * r * 0.24);
    ctx.stroke();
  }
  ctx.restore();
  gloss(ctx, r, 0.5);
  outline(ctx, r, 'rgba(60,95,35,0.8)');
}

function drawGrape(ctx, r) {
  // a small cluster of purple berries
  var berry = function (x, y, br) {
    ctx.fillStyle = radialGrad(ctx, br, -0.35, -0.4, [
      [0, '#c77dff'], [0.55, '#9d4edd'], [1, '#6a2fbf']
    ]);
    circle(ctx, x, y, br); ctx.fill();
  };
  var b = r * 0.48;
  // light purple backing so no white shows between the berries
  ctx.fillStyle = '#ddc2ff';
  circle(ctx, 0, 0, r * 0.97); ctx.fill();
  // cluster centered on (0,0) — every berry fully inside the circle
  berry(0, -r * 0.50, b);
  berry(-b * 1.05, 0, b);
  berry(b * 1.05, 0, b);
  berry(-b * 0.42, r * 0.46, b);
  berry(b * 0.42, r * 0.46, b);
  // highlights on each
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  [[0, -r * 0.50], [-b * 1.05, 0], [b * 1.05, 0],
   [-b * 0.42, r * 0.46], [b * 0.42, r * 0.46]].forEach(function (p) {
    circle(ctx, p[0] - b * 0.3, p[1] - b * 0.35, b * 0.28); ctx.fill();
  });
  outline(ctx, r, 'rgba(70,25,120,0.55)');
}

function drawPineapple(ctx, r) {
  // body: golden fill over the whole circle with crosshatch
  ctx.fillStyle = radialGrad(ctx, r, -0.35, -0.4, [
    [0, '#ffe29a'], [0.55, '#f4b942'], [1, '#c87f16']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r * 0.95);
  // crosshatch extended over the whole circle
  ctx.save();
  circle(ctx, 0, 0, r);
  ctx.clip();
  ctx.strokeStyle = 'rgba(150,95,20,0.4)';
  ctx.lineWidth = Math.max(1, r * 0.03);
  var i;
  for (i = -6; i <= 6; i++) {
    ctx.beginPath(); ctx.moveTo(i * r * 0.3 - r, -r); ctx.lineTo(i * r * 0.3 + r, r * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-i * r * 0.3 - r, -r); ctx.lineTo(-i * r * 0.3 + r, r * 2); ctx.stroke();
  }
  ctx.restore();
  outline(ctx, r, 'rgba(150,90,15,0.6)');
  // crown of leaves on TOP of everything (incl. the border)
  ctx.fillStyle = '#43aa2e';
  for (var k = -2; k <= 2; k++) {
    ctx.beginPath();
    ctx.moveTo(k * r * 0.16, -r * 0.78);
    ctx.quadraticCurveTo(k * r * 0.5, -r * 1.45, k * r * 0.34 + (k === 0 ? 0 : Math.sign(k) * r * 0.2), -r * 1.05);
    ctx.quadraticCurveTo(k * r * 0.28, -r * 0.95, k * r * 0.16 + (k === 0 ? 0 : Math.sign(k) * r * 0.1), -r * 0.7);
    ctx.closePath();
    ctx.fill();
  }
}

function drawWatermelon(ctx, r) {
  // big green melon with dark stripes
  ctx.fillStyle = radialGrad(ctx, r, -0.35, -0.4, [
    [0, '#8ee08a'], [0.55, '#4caf50'], [1, '#2e7d32']
  ]);
  circle(ctx, 0, 0, r); ctx.fill();
  rimShade(ctx, r, 0.9);
  // stripes clipped to sphere
  ctx.save();
  circle(ctx, 0, 0, r * 0.985); ctx.clip();
  ctx.strokeStyle = 'rgba(27,94,32,0.65)';
  ctx.lineWidth = Math.max(2, r * 0.11);
  var n = 6;
  for (var i = -n; i <= n; i += 2) {
    ctx.beginPath();
    ctx.moveTo(i * r * 0.18, -r * 1.05);
    ctx.quadraticCurveTo(i * r * 0.3, 0, i * r * 0.18, r * 1.05);
    ctx.stroke();
  }
  ctx.restore();
  gloss(ctx, r, 0.6);
  outline(ctx, r, 'rgba(20,70,24,0.85)');
}

/* ---------- tier table -------------------------------------- */

var FRUITS = [
  { name: 'Cherry',     r: 13, color: '#f03856', draw: drawCherry },
  { name: 'Strawberry', r: 17, color: '#ef4763', draw: drawStrawberry },
  { name: 'Kiwi',       r: 22, color: '#8d6239', draw: drawKiwi },
  { name: 'Orange',     r: 28, color: '#ff9f1c', draw: drawOrange },
  { name: 'Apple',      r: 35, color: '#ef233c', draw: drawApple },
  { name: 'Pear',       r: 44, color: '#b5cc2e', draw: drawPear },
  { name: 'Melon',      r: 54, color: '#9ccf6b', draw: drawMelon },
  { name: 'Grape',      r: 66, color: '#9d4edd', draw: drawGrape },
  { name: 'Pineapple',  r: 80, color: '#f4b942', draw: drawPineapple },
  { name: 'Watermelon', r: 95, color: '#4caf50', draw: drawWatermelon }
];

/** Points awarded when a merge produces the fruit at `resultTier`. */
var MERGE_SCORE = [2, 3, 4, 5, 6, 7, 8, 9, 10, 100]; // index = result tier (1..9)

/** Spawn weights for tiers 0..3 (only small fruits are dropped). */
var SPAWN_WEIGHTS = [42, 33, 18, 7];

function pickSpawnTier() {
  var total = 0;
  for (var i = 0; i < SPAWN_WEIGHTS.length; i++) total += SPAWN_WEIGHTS[i];
  var roll = Math.random() * total;
  for (i = 0; i < SPAWN_WEIGHTS.length; i++) {
    roll -= SPAWN_WEIGHTS[i];
    if (roll <= 0) return i;
  }
  return 0;
}

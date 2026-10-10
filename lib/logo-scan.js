// logoscan — "searching" logo engine, ported from the original web prototype
// (React canvas version).
// Pure geometry + painter, no DOM. Renders a Fibonacci-lattice sphere swept by a
// bright meridian that periodically condenses into the baked logo mark.
// Painter targets the Rokid single-green monochrome display: ink maps to the
// brightness of theme green on a black substrate (always-dark convention).

import POINTS from './logo-data.js';

const TURN = Math.PI * 2;
const GREEN = '64,255,94';

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Stable directions on a unit sphere (Fibonacci lattice). */
function fibDir(i, n) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

/** Shortest signed angular distance, wrapped to (-π, π]. */
function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Shared spin + tilt + orthographic projection. */
function makeProj(yaw, tilt, cx, cy, scale) {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

/** Smootherstep — zero first AND second derivative at both ends. */
function smootherE(x) {
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** easeInOutExpo — the CSS cubic-bezier(0.87, 0, 0.13, 1) curve. */
function expoInOut(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x < 0.5 ? 2 ** (20 * x - 10) / 2 : (2 - 2 ** (-20 * x + 10)) / 2;
}

/** The morph curve: smootherstep with a measured amount of expo mixed in. */
function morphEase(x, expo) {
  const smooth = smootherE(x);
  return smooth + (expoInOut(x) - smooth) * expo;
}

/** Rotation that cruises: eased at both ends, constant in between. */
function cruise(x, edge) {
  const a = Math.min(0.49, Math.max(0.001, edge));
  const v = 1 / (1 - a);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x < a) {
    const u = x / a;
    return v * a * (u * u * u - (u * u * u * u) / 2);
  }
  if (x > 1 - a) {
    const u = (1 - x) / a;
    return 1 - v * a * (u * u * u - (u * u * u * u) / 2);
  }
  return v * (a * 0.5 + (x - a));
}

/**
 * The cycle: dwell in the working form, morph to the mark, hold on the mark,
 * morph back. Returns { m, turns }: m = 0 working form, 1 = the mark; turns =
 * whole revolutions completed (always an integer when the mark is shown).
 */
function beatAt(t, dwell, morph, turns, settle, expo, hold) {
  const local = t % (dwell + morph * 2 + hold);
  const spinSpan = dwell + morph * settle;
  const spun = turns * cruise(Math.min(1, local / spinSpan), 0.22);
  if (local < dwell) return { m: 0, turns: spun };
  const intoMorph = local - dwell;
  if (intoMorph < morph) return { m: morphEase(intoMorph / morph, expo), turns: spun };
  if (intoMorph < morph + hold) return { m: 1, turns: spun };
  return { m: morphEase(1 - (intoMorph - morph - hold) / morph, expo), turns: spun };
}

/** Dot radii were tuned for a 300pt frame; sub-linear scaling keeps small
 * spinners legible. */
function radiusScale(size, pow) {
  return (size / 300) ** pow;
}

/** Ink for one projected dot: depth falloff + silhouette-rim structure. */
function inkOf(o, zx, edge) {
  return (o.inkFar ?? 0.6) - (o.inkSpan ?? 0.5) * zx - (o.inkRim ?? 0.16) * (1 - edge);
}

/**
 * Which sphere seat each dot flies home from, paired by angle so each dot
 * travels roughly radially and the silhouette is legible early.
 */
function seatMap(points) {
  const n = points.n;
  const byLogo = new Uint32Array(n);
  const bySeat = new Uint32Array(n);
  const logoAng = new Float32Array(n);
  const seatAng = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    byLogo[i] = i;
    bySeat[i] = i;
    logoAng[i] = Math.atan2(points.p[i * 3 + 1], points.p[i * 3]);
    const [sx, sy] = fibDir(i, n);
    seatAng[i] = Math.atan2(sy, sx);
  }
  byLogo.sort((a, b) => logoAng[a] - logoAng[b]);
  bySeat.sort((a, b) => seatAng[a] - seatAng[b]);
  const seats = new Uint32Array(n);
  for (let k = 0; k < n; k++) seats[byLogo[k]] = bySeat[k];
  return seats;
}

const SEATS = seatMap(POINTS);

const OPTS = {
  dwell: 1,
  turns: 1,
  morph: 3.1,
  hold: 1.5,
  expo: 0.3,
  settle: 0.1,
  tiltAmp: 0.34,
  sphereR: 0.94,
  poleEase: 1.4,
  arms: 13,
  armDepth: 0.72,
  armInk: 0.24,
  scanRate: 0.85,
  scanSwing: 1.05,
  scanWidth: 0.22,
  dimBase: 0.4,
  rBoost: 1.3,
  scanInk: 0.3,
  rBase: 0.8,
  rDepth: 1.4,
  inkFar: 0.6,
  inkSpan: 0.5,
  inkRim: 0.16,
  rsPow: 0.6,
  rMin: 0.3
};

/**
 * One finished frame for the scan state: dots z-sorted far→near into draw
 * order, radii clamped, invisible marks dropped.
 */
function frameLogoScan(size, t) {
  const o = OPTS;
  const { p, e, n } = POINTS;
  const seats = SEATS;
  const cx = size / 2;
  const R = (size / 2) * 0.82;
  const rs = radiusScale(size, o.rsPow);

  const b = beatAt(t, o.dwell, o.morph, o.turns, o.settle, o.expo, o.hold);
  const m = b.m;
  const g = 1 - m;

  const yaw = TURN * b.turns;
  const pt = makeProj(yaw, o.tiltAmp * g, cx, cx, R);

  const sphereR = o.sphereR;
  const width = o.scanWidth;
  // The sweep is anchored to the CAMERA: yaw + π/2 is whichever longitude
  // currently faces the viewer; bounded below π/2 it never reaches the
  // silhouette, so the lit band is always on the near side.
  const scan = yaw + Math.PI / 2 + o.scanSwing * Math.sin(t * o.scanRate);
  const arms = Math.max(3, Math.round(o.arms));
  const rMin = o.rMin;

  const dots = [];
  for (let i = 0; i < n; i++) {
    const [ax, ay, az] = fibDir(seats[i], n);
    // Compress latitude toward the equator: redistributes density without
    // reshaping the silhouette (ring radius recomputed from new latitude).
    const lat = (ay < 0 ? -1 : 1) * Math.abs(ay) ** o.poleEase;
    const ring0 = Math.sqrt(Math.max(1e-9, 1 - ay * ay));
    const ring = Math.sqrt(Math.max(0, 1 - lat * lat)) / ring0;
    const fx = ax * ring;
    const fy = lat;
    const fz = az * ring;

    // Weight the lattice's own spirals: i mod arms labels which arm a dot
    // belongs to; three repeating weights surface them as threads.
    const tier = (seats[i] % arms) % 3;
    const arm = 1 - o.armDepth * (tier === 0 ? 0 : tier === 1 ? 0.5 : 1);

    const x = p[i * 3] + (fx * sphereR - p[i * 3]) * g;
    const y = p[i * 3 + 1] + (fy * sphereR - p[i * 3 + 1]) * g;
    const z3 = p[i * 3 + 2] + (fz * sphereR - p[i * 3 + 2]) * g;

    // A meridian, not a spot: distance in longitude alone, so the lit band
    // runs pole to pole and the whole sphere is swept.
    const d = angleDelta(Math.atan2(fz, fx), scan);
    const boost = Math.exp(-(d * d) / width) * g;

    const [px, py, z] = pt(x, y, z3);
    const zx = clamp01((z + 1) / 2);
    const a = 1 - (1 - o.dimBase) * g * (1 - Math.min(1, boost));
    if (a < 0.02) continue;
    dots.push({
      x: px,
      y: py,
      z,
      r: Math.max(rMin, (o.rBase + o.rDepth * zx * arm + o.rBoost * boost) * rs),
      white: inkOf(o, zx, e[i] * m + (1 - m)) + o.armInk * (1 - arm) * g - o.scanInk * boost,
      a
    });
  }
  dots.sort((a, b) => a.z - b.z);
  return dots;
}

/** Paint one frame: ink → green brightness on black, far→near draw order. */
function paintGreen(ctx, dots) {
  for (const d of dots) {
    const b = clamp01(1 - clamp01(d.white)) * (d.a ?? 1);
    if (b <= 0.01) continue;
    ctx.fillStyle = 'rgba(' + GREEN + ',' + b.toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TURN);
    ctx.fill();
  }
}

/** Compute and paint one frame of the searching logo at time t (seconds). */
export function renderFrame(ctx, size, t) {
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, size, size);
  paintGreen(ctx, frameLogoScan(size, t));
}

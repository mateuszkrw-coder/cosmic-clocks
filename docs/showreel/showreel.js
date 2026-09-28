// Cosmic Clocks, the 15-second showreel.
//
// Every frame is a pure function of time: drawScene(ctx, t) paints the scene at
// t seconds, so the same t always gives the same picture. It is drawn from the
// site's own code and data: the pulsar catalogue (js/data.js), the pulse model
// (js/dsp.js) and the naked-eye star map (js/sky-data.js).
//
//   01 heartbeat    PSR B0329+54 ticking at its true 1.40 turns a second
//   02 spin-up      the tuning dial swept from 1.40 to 716.36 turns a second:
//                   beats, then a flutter, then a musical note
//   03 galaxy       the twelve pulsars at their real places in the Milky Way
//   04 instruments  single pulses of CP 1919 stacked, then folded into a clock
//   05 events       the supernova of 1054, a Vela glitch, the Crab in the sky
//   06 title
(() => {
'use strict';

const W = 1920, H = 1080, DURATION = 15;
const CAT = window.CC;
const TAU = Math.PI * 2, DEG = Math.PI / 180;

// ------------------------------------------------------------------ math

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a)));
const E = {
  lin: (x) => x,
  inQuad: (x) => x * x,
  outQuad: (x) => 1 - (1 - x) * (1 - x),
  inCubic: (x) => x * x * x,
  outCubic: (x) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outQuart: (x) => 1 - Math.pow(1 - x, 4),
  inQuart: (x) => x ** 4,
  inOutQuart: (x) => (x < 0.5 ? 8 * x ** 4 : 1 - Math.pow(-2 * x + 2, 4) / 2),
  outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inExpo: (x) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutExpo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  outBack: (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2),
};
const P = (t, a, b, e = E.lin) => e(prog(t, a, b));
// Motion blur averages sub-frames around each frame. Numbers, typed text and
// scrambled glyphs change in steps, so they follow the frame's own time (TF)
// and stay crisp instead of showing two values at once. SL is the slice of the
// shutter a sub-frame stands for and SK its index: particles pick their own
// instant inside the slice, so even a beam turning 716 times a second blurs smoothly.
let TF = 0, SL = 0, SK = 0;

// Damped spring from 0 to 1: s seconds after release, overshoots once and settles.
function spring(s, w = 16, z = 0.5) {
  if (s <= 0) return 0;
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * s) * (Math.cos(wd * s) + (z * w / wd) * Math.sin(wd * s));
}
function hash(i) {
  let x = Math.imul((i | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}
const noise = (x, seed = 0) => {
  const i = Math.floor(x);
  return lerp(hash(i + seed * 7919), hash(i + 1 + seed * 7919), smooth(x - i));
};
function rng(seed) {                       // the same xorshift the site uses
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}
function gaussRand(r) {
  const u = Math.max(r(), 1e-9), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
}
const gaussHash = (i) => Math.sqrt(-2 * Math.log(Math.max(hash(i), 1e-9))) * Math.cos(TAU * hash(i ^ 0x5bd1e995));
const fmt = (n) => Math.floor(n).toLocaleString('en-US');

// ------------------------------------------------------------------ look

// The site's palette (css/style.css).
const COL = {
  ink: '#e9edf6', ink2: '#aab3c7', ink3: '#6b7489', ice: '#9fe7ff', amber: '#ffb547',
  ember: '#ff6a3a', rose: '#ff7a96', violet: '#c6a6ff', line: 'rgba(160,185,240,0.16)', line2: 'rgba(160,185,240,0.3)',
};
const rgbCache = new Map();
function rgb(hex) {
  let v = rgbCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(hex, v);
  }
  return v;
}
const rgba = (hex, a) => { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; };
const css3 = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// The site's typefaces: Cormorant for display, Martian Mono for data, Archivo for text.
const SERIF = 'Cormorant', NUM = '"Cormorant Lining"', MONO = '"Martian Mono"', SANS = 'Archivo';
const font = (weight, size, family = SERIF, italic = false, stretch = '') =>
  `${italic ? 'italic ' : ''}${weight} ${stretch ? stretch + ' ' : ''}${size}px ${family}`;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function text(ctx, str, x, y, f, color, align = 'left', spacing = 0) {
  ctx.font = f;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.letterSpacing = `${spacing}px`;
  // Letter spacing also trails the last glyph: shift centred and right-aligned text back.
  ctx.fillText(str, align === 'center' ? x + spacing / 2 : align === 'right' ? x + spacing : x, y);
  if (spacing) ctx.letterSpacing = '0px';
}
const widths = new Map();
function measure(ctx, str, f, spacing = 0) {
  const key = `${f}|${spacing}|${str}`;
  let w = widths.get(key);
  if (w === undefined) {
    ctx.font = f;
    ctx.letterSpacing = `${spacing}px`;
    w = ctx.measureText(str).width - spacing;
    ctx.letterSpacing = '0px';
    widths.set(key, w);
  }
  return w;
}
// Scrambled text that settles left to right, like a radio locking on to a station.
const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789+−·/#';
function scramble(str, p, seed) {
  if (p >= 1) return str;
  let out = '';
  const n = str.length;
  for (let i = 0; i < n; i++) {
    const c = str[i];
    if (c === ' ') { out += ' '; continue; }
    const lock = (i + 1) / (n + 1) * 0.75 + 0.2;
    if (p >= lock) out += c;
    else if (p > lock - 0.45) out += GLYPHS[Math.floor(hash(i * 131 + seed * 977 + Math.floor(TF * 30)) * GLYPHS.length)];
    else out += ' ';
  }
  return out;
}
function glowSprite(c, size = 128, core = 0.14) {
  const cv = canvas(size, size), g = cv.getContext('2d'), r = size / 2;
  const grad = g.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, css3(mix3(c, [1, 1, 1], 0.7), 1));
  grad.addColorStop(core * 0.5, css3(c, 0.95));
  grad.addColorStop(core * 1.4, css3(c, 0.42));
  grad.addColorStop(0.45, css3(c, 0.1));
  grad.addColorStop(0.75, css3(c, 0.025));
  grad.addColorStop(1, css3(c, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return cv;
}
function sprite(ctx, img, x, y, radius, alpha = 1) {
  if (alpha <= 0.002 || radius <= 0.5) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
  ctx.globalAlpha = 1;
}
const GLOW = {
  white: glowSprite([1, 1, 1]), ice: glowSprite([0.62, 0.9, 1.0]), amber: glowSprite([1.0, 0.71, 0.28]),
  ember: glowSprite([1.0, 0.42, 0.23]), violet: glowSprite([0.75, 0.45, 1.0]), soft: glowSprite([0.6, 0.8, 1.0], 128, 0.02),
};

// ------------------------------------------------------------------ light buffer
// Stars, galaxy, beams and debris are splatted into a float buffer in linear light
// (additive, like light), then encoded once and laid over the canvas.

function lightBuffer(scale) {
  const w = W / scale, h = H / scale;
  const buf = new Float32Array(w * h * 3);
  const layer = canvas(w, h);
  const lctx = layer.getContext('2d');
  const img = lctx.createImageData(w, h);
  const px = img.data;
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  const LUT = new Uint8Array(4097);
  for (let i = 0; i <= 4096; i++) {
    const v = i / 4096;
    LUT[i] = Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  const gx = new Float32Array(72), gy = new Float32Array(72);
  const inv = 1 / scale;

  function pt(x, y, r, g, b) {
    x = x * inv - 0.5; y = y * inv - 0.5;
    if (!(x >= 0 && y >= 0 && x < w - 1 && y < h - 1)) return;
    const ix = x | 0, iy = y | 0, fx = x - ix, fy = y - iy;
    if (ix < x0) x0 = ix;
    if (ix + 1 > x1) x1 = ix + 1;
    if (iy < y0) y0 = iy;
    if (iy + 1 > y1) y1 = iy + 1;
    let i = (iy * w + ix) * 3;
    let k = (1 - fx) * (1 - fy);
    buf[i] += r * k; buf[i + 1] += g * k; buf[i + 2] += b * k;
    k = fx * (1 - fy);
    buf[i + 3] += r * k; buf[i + 4] += g * k; buf[i + 5] += b * k;
    i += w * 3;
    k = (1 - fx) * fy;
    buf[i] += r * k; buf[i + 1] += g * k; buf[i + 2] += b * k;
    k = fx * fy;
    buf[i + 3] += r * k; buf[i + 4] += g * k; buf[i + 5] += b * k;
  }
  // A soft round splat, in full-size pixels; r, g, b is the value at its centre.
  function blob(x, y, sigma, r, g, b) {
    sigma *= inv;
    if (sigma < 0.75) { const k = 2 * Math.PI * sigma * sigma; pt(x, y, r * k, g * k, b * k); return; }
    sigma = Math.min(sigma, 12);
    x *= inv; y *= inv;
    const R = Math.min(32, Math.ceil(sigma * 2.6));
    const cx = Math.round(x), cy = Math.round(y);
    if (cx + R < 0 || cy + R < 0 || cx - R >= w || cy - R >= h) return;
    const k = -0.5 / (sigma * sigma);
    for (let d = -R; d <= R; d++) {
      const ex = cx + d + 0.5 - x, ey = cy + d + 0.5 - y;
      gx[d + R] = Math.exp(ex * ex * k);
      gy[d + R] = Math.exp(ey * ey * k);
    }
    const xa = Math.max(0, cx - R), xb = Math.min(w - 1, cx + R);
    const ya = Math.max(0, cy - R), yb = Math.min(h - 1, cy + R);
    if (xa < x0) x0 = xa;
    if (xb > x1) x1 = xb;
    if (ya < y0) y0 = ya;
    if (yb > y1) y1 = yb;
    for (let yy = ya; yy <= yb; yy++) {
      const wy = gy[yy - cy + R];
      let i = (yy * w + xa) * 3;
      for (let xx = xa; xx <= xb; xx++, i += 3) {
        const q = wy * gx[xx - cx + R];
        buf[i] += r * q; buf[i + 1] += g * q; buf[i + 2] += b * q;
      }
    }
  }
  // Encode what was splatted, add it onto the canvas and clear the buffer.
  function flush(ctx, gain = 1) {
    if (x1 < x0 || y1 < y0) return;
    const k = 4096 * gain;
    for (let y = y0; y <= y1; y++) {
      let i = (y * w + x0) * 3, o = (y * w + x0) * 4;
      for (let x = x0; x <= x1; x++, i += 3, o += 4) {
        const r = buf[i] * k, g = buf[i + 1] * k, b = buf[i + 2] * k;
        px[o] = LUT[r < 4096 ? r | 0 : 4096];
        px[o + 1] = LUT[g < 4096 ? g | 0 : 4096];
        px[o + 2] = LUT[b < 4096 ? b | 0 : 4096];
        buf[i] = buf[i + 1] = buf[i + 2] = 0;
      }
    }
    // a pixel of margin, so the smoothed upscale of the soft buffer fades out cleanly
    const m = scale > 1 ? 1 : 0;
    const ax = Math.max(0, x0 - m), ay = Math.max(0, y0 - m);
    const bw = Math.min(w, x1 + 1 + m) - ax, bh = Math.min(h, y1 + 1 + m) - ay;
    lctx.putImageData(img, 0, 0, ax, ay, bw, bh);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer, ax, ay, bw, bh, ax * scale, ay * scale, bw * scale, bh * scale);
    ctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(ax, ay, bw, bh);   // nothing stale left for the smoothing filter to reach
    if (m) {                       // clear the margin too
      for (let y = ay; y < ay + bh; y++) for (let x = ax; x < ax + bw; x++) { const o = (y * w + x) * 4; px[o] = px[o + 1] = px[o + 2] = 0; }
    }
    x0 = w; y0 = h; x1 = -1; y1 = -1;
  }
  return { pt, blob, flush };
}
const SPL = lightBuffer(1);      // stars, sparks, debris: sharp
const SOFT = lightBuffer(4);     // beam haze and glows: a quarter the size, smoothed back up

// ------------------------------------------------------------------ 3D

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)],
};
function camera(pos, target, upHint, focal, cx = W / 2, cy = H / 2, roll = 0) {
  const f = V.norm(V.sub(target, pos));
  let r = V.norm(V.cross(f, upHint));
  let u = V.cross(r, f);
  if (roll) {
    const c = Math.cos(roll), s = Math.sin(roll);
    const r2 = V.add(V.mul(r, c), V.mul(u, s));
    u = V.sub(V.mul(u, c), V.mul(r, s));
    r = r2;
  }
  return { px: pos[0], py: pos[1], pz: pos[2], fx: f[0], fy: f[1], fz: f[2], rx: r[0], ry: r[1], rz: r[2],
    ux: u[0], uy: u[1], uz: u[2], focal, cx, cy, pos, f };
}
const OUT = [0, 0, 0], OUT2 = [0, 0, 0];
function proj(c, x, y, z, out = OUT) {
  const dx = x - c.px, dy = y - c.py, dz = z - c.pz;
  const d = dx * c.fx + dy * c.fy + dz * c.fz;
  if (d < 1e-4) return false;
  const s = c.focal / d;
  out[0] = c.cx + (dx * c.rx + dy * c.ry + dz * c.rz) * s;
  out[1] = c.cy - (dx * c.ux + dy * c.uy + dz * c.uz) * s;
  out[2] = d;
  return true;
}

// ------------------------------------------------------------------ timeline (seconds)

const P0 = 0.7145197;                    // PSR B0329+54, "the heartbeat": one turn every 0.7145 s
const F_END = 716.36;                    // PSR J1748-2446ad, the fastest spin known
const T = {
  tick0: 0.32,                           // the first heartbeat
  s2: 0.32 + 3 * P0,                     // the fourth heartbeat starts the spin-up (2.464)
  land: 0.32 + 3 * P0 + 2.25,            // the dial lands on 716.36 turns a second (4.714)
  s3: 5.3, edge: 6.96, s4: 7.7, fold: 9.08, s5: 10.1, glitch: 10.9, quake: 11.08, sky: 11.7,
  s6: 12.5, end: 15.0,
};
const CHAPTERS = [[0, '01', 'HEARTBEAT'], [T.s2, '02', 'SPIN-UP'], [T.s3, '03', 'GALAXY'], [T.s4, '04', 'INSTRUMENTS'],
  [T.s5, '05', 'EVENTS'], [T.s6, '06', 'TUNE IN']];

// The spin: one continuous phase for the whole film, in turns. Integer = the beam
// sweeps past Earth = one tick. Before the spin-up it is B0329+54's true rate;
// then the log of the rate accelerates (an exponential in decades per second)
// and eases to rest on 716.36 turns a second.
const SPIN = (() => {
  const dt = 1 / 4000, n = Math.ceil((DURATION + 0.1 - T.s2) / dt) + 1;
  const s0 = Math.log10(1 / P0), s1 = Math.log10(F_END);
  const v0 = 0.4, k = 1.4, tau1 = 1.9, tau2 = 2.25;
  const vel = (tau) => {
    if (tau < tau1) return v0 * Math.exp(k * tau);
    if (tau < tau2) return v0 * Math.exp(k * tau1) * 0.5 * (1 + Math.cos(Math.PI * (tau - tau1) / (tau2 - tau1)));
    return 0;
  };
  let total = 0;
  const raw = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    total += 0.5 * (vel((i - 1) * dt) + vel(i * dt)) * dt;
    raw[i] = total;
  }
  const end = raw[Math.round(tau2 / dt)];
  const logr = new Float64Array(n), phi = new Float64Array(n);
  for (let i = 0; i < n; i++) logr[i] = s0 + (s1 - s0) * Math.min(1, raw[i] / end);
  phi[0] = 3;
  for (let i = 1; i < n; i++) phi[i] = phi[i - 1] + 0.5 * (10 ** logr[i - 1] + 10 ** logr[i]) * dt;
  return { dt, n, logr, phi };
})();
function spinRate(t) {
  if (t < T.s2) return 1 / P0;
  const x = (t - T.s2) / SPIN.dt, i = Math.min(SPIN.n - 2, x | 0);
  return 10 ** lerp(SPIN.logr[i], SPIN.logr[i + 1], x - i);
}
function spinPhase(t) {
  if (t < T.s2) return (t - T.tick0) / P0;
  const x = (t - T.s2) / SPIN.dt, i = Math.min(SPIN.n - 2, x | 0);
  return lerp(SPIN.phi[i], SPIN.phi[i + 1], x - i);
}
// When the rate passes each station of the dial.
function timeAtRate(f) {
  if (f <= 1 / P0) return T.s2;
  const target = Math.log10(f);
  for (let i = 1; i < SPIN.n; i++) if (SPIN.logr[i] >= target - 1e-9) return T.s2 + i * SPIN.dt;
  return T.land;
}

// ------------------------------------------------------------------ data

const PULSARS = CAT.PULSARS.map((p, i) => ({
  ...p, i, f: 1 / p.P, g: CAT.galacticXYZ(p),
  label: p.short === 'J1748ad' ? 'J1748AD' : p.short.toUpperCase(),
}));
const BY_ID = Object.fromEntries(PULSARS.map((p) => [p.short, p]));
const MAIN = BY_ID.B0329, FAST = BY_ID.J1748ad, CP1919 = BY_ID.B1919, VELA = BY_ID.Vela, CRAB = BY_ID.Crab;
// Stations the dial passes during the spin-up, slowest first.
const STATIONS = PULSARS.map((p) => ({ p, t: p.f <= 1 / P0 + 1e-6 ? (p === MAIN ? T.s2 : -1) : timeAtRate(p.f) }));

// Background stars around the close-ups: a shell of real 3D points, so the camera can fly out through them.
const SHELL = (() => {
  const r = rng(329), n = 5200, out = new Float32Array(n * 7);
  for (let i = 0; i < n; i++) {
    const u = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - u * u);
    const d = 120 + 1400 * Math.pow(r(), 0.7);
    const mag = Math.pow(r(), 3.2);
    const warm = r();
    const c = warm < 0.55 ? [0.8, 0.87, 1.0] : warm < 0.85 ? [1.0, 0.95, 0.88] : [1.0, 0.8, 0.6];
    out.set([s * Math.cos(a) * d, u * d, s * Math.sin(a) * d, c[0], c[1], c[2], 0.12 + 1.6 * mag], i * 7);
  }
  return out;
})();

// Nebulae behind the close-ups: domain-warped value noise, drawn once per palette at quarter size.
function nebula(seed, a, b, amt = 1) {
  const w = 480, h = 270, cv = canvas(w, h), g = cv.getContext('2d'), im = g.createImageData(w, h);
  const vn = (x, y, s) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
    const h00 = hash(xi * 374761 + yi * 668265 + s), h10 = hash((xi + 1) * 374761 + yi * 668265 + s);
    const h01 = hash(xi * 374761 + (yi + 1) * 668265 + s), h11 = hash((xi + 1) * 374761 + (yi + 1) * 668265 + s);
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fy);
  };
  const fbm = (x, y, s) => { let v = 0, am = 0.5, f = 1; for (let o = 0; o < 5; o++) { v += am * vn(x * f, y * f, s + o * 31); f *= 2.03; am *= 0.5; } return v; };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / h * 2.2, v = y / h * 2.2;
      const wx = fbm(u + 3.1, v + 1.7, seed), wy = fbm(u - 2.3, v + 5.2, seed + 9);
      const n1 = fbm(u + 1.8 * wx, v + 1.8 * wy, seed + 17);
      const n2 = fbm(u * 1.6 - 1.2 * wy, v * 1.6 + 1.2 * wx, seed + 29);
      const d1 = Math.pow(sstep(0.42, 0.85, n1), 1.6) * amt, d2 = Math.pow(sstep(0.45, 0.9, n2), 2) * amt;
      const o = (y * w + x) * 4;
      im.data[o] = clamp(a[0] * d1 + b[0] * d2) * 255;
      im.data[o + 1] = clamp(a[1] * d1 + b[1] * d2) * 255;
      im.data[o + 2] = clamp(a[2] * d1 + b[2] * d2) * 255;
      im.data[o + 3] = 255;
    }
  }
  g.putImageData(im, 0, 0);
  return cv;
}
const NEB = {
  main: nebula(12, [0.05, 0.36, 0.44], [0.04, 0.12, 0.3]),
  fast: nebula(144, [0.55, 0.3, 0.1], [0.24, 0.1, 0.05]),
  vela: nebula(21, [0.62, 0.16, 0.5], [0.08, 0.42, 0.52]),
  crab: nebula(54, [0.6, 0.22, 0.07], [0.06, 0.16, 0.4], 0.8),
};

// The Milky Way, built the way the site builds it (js/scene.js): bulge, bar,
// exponential disc, four trailing arms, the local spur and the Sun's neighbourhood.
const GALAXY = (() => {
  const r = rng(1967), out = [];
  const put = (x, y, z, c, b) => out.push(x, y, z, c[0] * b, c[1] * b, c[2] * b);
  let i, R, a, t;
  for (i = 0; i < 9000; i++) {
    R = Math.abs(gaussRand(r)) * 0.8 + 0.05; a = r() * TAU;
    put(Math.cos(a) * R, Math.sin(a) * R * 0.8, gaussRand(r) * 0.32 * Math.exp(-R * 0.4), [1.0, 0.72, 0.42], 0.5 + r());
  }
  const barA = Math.PI - 27 * DEG;
  for (i = 0; i < 6000; i++) {
    const u = gaussRand(r) * 2.1, w = gaussRand(r) * 0.5;
    put(Math.cos(barA) * u - Math.sin(barA) * w, Math.sin(barA) * u + Math.cos(barA) * w, gaussRand(r) * 0.18, [1.0, 0.78, 0.5], 0.5 + 0.7 * r());
  }
  for (i = 0; i < 20000; i++) {
    R = -3.0 * Math.log(1 - r() * 0.985) + 1.5; if (R > 17) continue;
    a = r() * TAU;
    put(Math.cos(a) * R, Math.sin(a) * R, gaussRand(r) * 0.1, [0.82, 0.83, 0.95], 0.3 + 0.5 * r());
  }
  const pitch = Math.tan(12 * DEG), th0 = Math.PI - Math.log(6.94 / 4) / pitch;
  for (let arm = 0; arm < 4; arm++) {
    for (i = 0; i < 12500; i++) {
      t = r() * 6.6;
      R = 4 * Math.exp(t * pitch); if (R > 17.5) continue;
      a = th0 + arm * Math.PI / 2 + t;
      const sc = gaussRand(r) * (0.16 + R * 0.018), sa = gaussRand(r) * 0.035;
      const young = r(), hii = young >= 0.94;
      const col = young < 0.72 ? [0.6, 0.75, 1.0] : !hii ? [0.93, 0.91, 1.0] : [1.0, 0.42, 0.6];
      put(Math.cos(a + sa) * (R + sc), Math.sin(a + sa) * (R + sc), gaussRand(r) * 0.07, col, hii ? 1.6 + 1.2 * r() : 0.7 + 0.9 * r());
    }
  }
  for (i = 0; i < 4000; i++) {
    t = (r() - 0.55) * 1.3;
    a = Math.PI + t; R = 8.35 * Math.exp(t * Math.tan(10 * DEG)) + gaussRand(r) * 0.25;
    put(Math.cos(a) * R, Math.sin(a) * R, gaussRand(r) * 0.06, [0.72, 0.82, 1.0], 0.6 + 0.8 * r());
  }
  for (i = 0; i < 6000; i++) {
    const d = Math.pow(r(), 0.6) * 2.4, b = r() * TAU;
    put(-CAT.R_SUN_KPC + Math.cos(b) * d, Math.sin(b) * d, gaussRand(r) * 0.12, r() < 0.5 ? [1.0, 0.9, 0.8] : [0.8, 0.88, 1.0], 0.4 + 0.8 * r());
  }
  return new Float32Array(out);
})();
const GAL_N = GALAXY.length / 6;

// CP 1919's single pulses, from the site's own pulse model: two components,
// drifting subpulses, pulse-to-pulse brightness, the occasional null.
const STACK = (() => {
  const model = new CAT.DSP.PulseModel(CP1919.sound);
  const N = 40, S = 220, win = 0.05, k0 = 1967;
  const lines = [], mean = new Float32Array(S);
  for (let j = 0; j < N; j++) {
    const v = new Float32Array(S);
    for (let i = 0; i < S; i++) {
      const x = -win + (2 * win * i) / (S - 1);
      const nz = (gaussHash(j * 4001 + i) + gaussHash(j * 4001 + i + 1) + gaussHash(j * 4001 + i + 2)) / 3;
      v[i] = model.value(k0 + j, x, 1) + 0.045 * nz;
      mean[i] += model.value(k0 + j, x, 1) / N;
    }
    lines.push(v);
  }
  return { N, S, win, lines, mean };
})();

// The naked-eye sky (the site's js/sky-data.js: Hipparcos stars and IAU figures).
const SKY = (() => {
  const SK = CAT.SKY, bin = atob(SK.stars), n = SK.starCount;
  const u16 = new Uint16Array(n * 4);
  for (let i = 0; i < n * 4; i++) u16[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
  const BV = [[-0.4, [0.62, 0.72, 1.0]], [0.0, [0.8, 0.86, 1.0]], [0.4, [1.0, 0.97, 0.93]], [0.8, [1.0, 0.88, 0.72]], [1.2, [1.0, 0.78, 0.56]], [1.8, [1.0, 0.66, 0.42]]];
  const bvColor = (b) => {
    if (b <= BV[0][0]) return BV[0][1];
    for (let i = 1; i < BV.length; i++) if (b <= BV[i][0]) return mix3(BV[i - 1][1], BV[i][1], (b - BV[i - 1][0]) / (BV[i][0] - BV[i - 1][0]));
    return BV[BV.length - 1][1];
  };
  const stars = [];
  for (let i = 0; i < n; i++) {
    const ra = u16[i * 4] / 65535 * 360, dec = u16[i * 4 + 1] / 65535 * 180 - 90;
    const mag = u16[i * 4 + 2] / 1000 - 2, bv = u16[i * 4 + 3] / 10000 - 0.5;
    stars.push({ ra, dec, mag, c: bvColor(bv) });
  }
  const fig = (id) => (SK.lines.find((l) => l[0] === id) || [id, []])[1];
  return { stars, taurus: fig('Tau'), orion: fig('Ori'), others: SK.lines.filter((l) => l[0] !== 'Tau' && l[0] !== 'Ori').map((l) => l[1]) };
})();

// ------------------------------------------------------------------ the neutron star
//
// A lighthouse: a sphere with two beams along its magnetic axis, tilted by alpha from
// the spin axis. The camera sits zeta from the spin axis; the beam sweeps past it
// when the spin phase is a whole number, which is when you hear the tick.

const BEAM_N = 2600, BEAM_SOFT = 260;
const BEAM = (() => {
  const b = new Float32Array((BEAM_N + BEAM_SOFT) * 5);
  for (let i = 0; i < BEAM_N + BEAM_SOFT; i++) {
    b[i * 5] = hash(i * 7 + 1);                    // position along the beam
    b[i * 5 + 1] = Math.abs(gaussHash(i * 7 + 2)); // distance from the axis, in beam widths
    b[i * 5 + 2] = hash(i * 7 + 3) * TAU;          // angle around the axis
    b[i * 5 + 3] = 0.3 + 0.7 * hash(i * 7 + 4);    // brightness
    b[i * 5 + 4] = hash(i * 7 + 5);                // speed
  }
  return b;
})();
// Dipole field lines r = L sin^2(theta), in the magnetic frame.
const FIELD = (() => {
  const lines = [];
  [2.1, 3.0, 4.4, 6.4].forEach((L, li) => {
    const th0 = Math.asin(Math.sqrt(1 / L));
    for (let a = 0; a < 8; a++) {
      const ph = (a / 8) * TAU + li * 0.4;
      const pts = [];
      for (let s = 0; s <= 44; s++) {
        const th = lerp(th0, Math.PI - th0, s / 44), r = L * Math.sin(th) ** 2;
        pts.push([r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]);
      }
      lines.push(pts);
    }
  });
  return lines;
})();

function pulsarView(o) {
  // o: dist, zeta, az, roll, cx, cy, focal, lift (camera target height)
  const S = [0, 1, 0];
  const C = [Math.sin(o.zeta) * Math.sin(o.az), Math.cos(o.zeta), Math.sin(o.zeta) * Math.cos(o.az)];
  const e1 = [Math.sin(o.az), 0, Math.cos(o.az)], e2 = V.cross(S, e1);
  const cam = camera(V.mul(C, o.dist), [0, o.lift || 0, 0], S, o.focal, o.cx, o.cy, o.roll);
  return { S, C, e1, e2, cam };
}

// The flash seen from the camera, averaged over the slice of shutter this sub-frame covers.
function beamFlash(view, alpha, rho, phase, rate) {
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const cz = V.dot(view.C, view.S);
  const sz = Math.sqrt(Math.max(0, 1 - cz * cz));
  const at = (psi) => {
    const cd = ca * cz + sa * sz * Math.cos(psi);
    const d = Math.acos(clamp(cd, -1, 1));
    return Math.exp(-(d / rho) * (d / rho));
  };
  const turns = rate * SL;
  if (turns > 0.6) {                       // many turns in the slice: the duty-cycle average
    let s = 0;
    for (let i = 0; i < 64; i++) s += at((i / 64) * TAU);
    return s / 64;
  }
  let s = 0;
  for (let i = 0; i < 8; i++) s += at(TAU * (phase + rate * ((i + 0.5) / 8 - 0.5) * SL));
  return s / 8;
}

function drawPulsar(ctx, t, o) {
  const view = pulsarView(o), cam = view.cam, S = view.S;
  const phase = o.phase, rate = o.rate;
  const ca = Math.cos(o.alpha), sa = Math.sin(o.alpha);
  const e1 = view.e1, e2 = view.e2;
  const mAt = (ph) => {
    const ps = TAU * ph, cp = Math.cos(ps), sp = Math.sin(ps);
    const u = [cp * e1[0] + sp * e2[0], cp * e1[1] + sp * e2[1], cp * e1[2] + sp * e2[2]];
    return { m: V.add(V.mul(S, ca), V.mul(u, sa)), q1: [-sp * e1[0] + cp * e2[0], -sp * e1[1] + cp * e2[1], -sp * e1[2] + cp * e2[2]], q2: V.sub(V.mul(S, sa), V.mul(u, ca)) };
  };
  const now = mAt(phase);
  const beamC = o.beam, haloC = o.halo;

  // background: nebula and the star shell
  if (o.neb) {
    for (const [img, a] of o.neb) {
      if (a <= 0.003) continue;
      const sc = o.nebScale || 1;
      ctx.globalAlpha = a;
      ctx.globalCompositeOperation = 'lighter';
      const w = W * 1.16 * sc, h = H * 1.16 * sc;
      ctx.drawImage(img, W / 2 - w / 2 - o.az * 120 + (o.cx - W / 2) * 0.25, H / 2 - h / 2, w, h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
  if (o.stars > 0) {
    const camA = pulsarView({ ...o, dist: o.distA ?? o.dist }).cam, camB = pulsarView({ ...o, dist: o.distB ?? o.dist }).cam;
    for (let i = 0; i < SHELL.length; i += 7) {
      const h = hash(i + SK * 7919);
      if (!proj(camA, SHELL[i], SHELL[i + 1], SHELL[i + 2], OUT) || !proj(camB, SHELL[i], SHELL[i + 1], SHELL[i + 2], OUT2)) continue;
      const x = lerp(OUT[0], OUT2[0], h), y = lerp(OUT[1], OUT2[1], h), z = lerp(OUT[2], OUT2[2], h);
      const b = SHELL[i + 6] * o.stars * Math.min(1, 900 / (z * z) + 0.35) * 0.55;
      SPL.pt(x, y, SHELL[i + 3] * b, SHELL[i + 4] * b, SHELL[i + 5] * b);
    }
    SPL.flush(ctx);
  }

  // where the star is on screen
  proj(cam, 0, 0, 0, OUT);
  const sx = OUT[0], sy = OUT[1], sd = OUT[2];
  const R = cam.focal / sd;

  // field lines behind the star
  const drawField = (front) => {
    if (!(o.field > 0.01)) return;
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = css3(mix3(haloC, [1, 1, 1], 0.35), o.field * (front ? 1 : 0.5));
    ctx.beginPath();
    const X = now.q2, Y = now.q1, Z = now.m;
    for (const pts of FIELD) {
      let pen = false;
      for (const p of pts) {
        const wx = p[0] * X[0] + p[1] * Y[0] + p[2] * Z[0];
        const wy = p[0] * X[1] + p[1] * Y[1] + p[2] * Z[1];
        const wz = p[0] * X[2] + p[1] * Y[2] + p[2] * Z[2];
        const isFront = wx * view.C[0] + wy * view.C[1] + wz * view.C[2] > 0;
        if (isFront !== front || !proj(cam, wx, wy, wz, OUT)) { pen = false; continue; }
        if (pen) ctx.lineTo(OUT[0], OUT[1]); else ctx.moveTo(OUT[0], OUT[1]);
        pen = true;
      }
    }
    ctx.stroke();
  };
  drawField(false);

  // the halo and the star
  sprite(ctx, o.haloSprite || GLOW.ice, sx, sy, R * 7, 0.5 * o.body);
  const grad = ctx.createRadialGradient(sx - R * 0.3, sy - R * 0.35, R * 0.05, sx, sy, R);
  grad.addColorStop(0, css3([1, 1, 1], o.body));
  grad.addColorStop(0.6, css3(mix3(o.surf, [1, 1, 1], 0.55), o.body));
  grad.addColorStop(1, css3(mix3(o.surf, haloC, 0.35), o.body));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sx, sy, R, 0, TAU);
  ctx.fill();
  drawField(true);

  // beams: every particle picks its own instant inside the shutter slice
  const L = o.length, rho = o.rho, flow = 5.5;
  for (let beam = 0; beam < 2; beam++) {
    const sign = beam === 0 ? 1 : -1;
    for (let i = 0; i < BEAM_N + BEAM_SOFT; i++) {
      const b = i * 5, soft = i >= BEAM_N;
      const hj = hash(i * 13 + beam * 7 + SK * 104729);
      const ph = phase + rate * (hj - 0.5) * SL;
      const ps = TAU * ph, cp = Math.cos(ps), sp = Math.sin(ps);
      const ux = cp * e1[0] + sp * e2[0], uy = cp * e1[1] + sp * e2[1], uz = cp * e1[2] + sp * e2[2];
      const mx = (ca * S[0] + sa * ux) * sign, my = (ca * S[1] + sa * uy) * sign, mz = (ca * S[2] + sa * uz) * sign;
      const q1x = -sp * e1[0] + cp * e2[0], q1y = -sp * e1[1] + cp * e2[1], q1z = -sp * e1[2] + cp * e2[2];
      const q2x = sa * S[0] - ca * ux, q2y = sa * S[1] - ca * uy, q2z = sa * S[2] - ca * uz;
      const along = (BEAM[b] + t * flow / L * (0.6 + 0.8 * BEAM[b + 4])) % 1;
      const d = 1.05 + (L - 1.05) * Math.pow(along, soft ? 1.3 : 1.9);
      const off = BEAM[b + 1] * rho * (soft ? 0.5 : 0.62) * d, ang = BEAM[b + 2];
      const ox = Math.cos(ang) * off, oy = Math.sin(ang) * off;
      const px = mx * d + q1x * ox + q2x * oy, py = my * d + q1y * ox + q2y * oy, pz = mz * d + q1z * ox + q2z * oy;
      if (!proj(cam, px, py, pz, OUT)) continue;
      const z = OUT[2];
      if (z < 0.6) continue;
      const fade = Math.pow(1 - (d - 1.05) / (L - 1.05), 1.4) * Math.min(1, (d - 1.0) * 1.2);
      const near = Math.min(1, z / 2.5);
      const wv = clamp((d - 1) / 5);
      const cr = lerp(1, beamC[0], wv), cg = lerp(1, beamC[1], wv), cb = lerp(1, beamC[2], wv);
      if (soft) {
        const sig = Math.min(40, 0.24 * rho * d * cam.focal / z + 2);
        const v = 0.026 * o.beamGain * fade * BEAM[b + 3] * sstep(2, 9, z);
        SOFT.blob(OUT[0], OUT[1], sig, cr * v, cg * v, cb * v);
      } else {
        const v = 0.55 * o.beamGain * fade * BEAM[b + 3] * near * Math.exp(-0.5 * BEAM[b + 1] * BEAM[b + 1]);
        const sig = Math.min(3.2, 0.45 + 2.2 / z);
        SPL.blob(OUT[0], OUT[1], sig, cr * v, cg * v, cb * v);
      }
    }
  }
  // hot polar caps
  for (let j = 0; j < 6; j++) {
    const m = mAt(phase + rate * ((j + 0.5) / 6 - 0.5) * SL).m;
    for (const sign of [1, -1]) {
      const px = m[0] * sign, py = m[1] * sign, pz = m[2] * sign;
      const facing = px * view.C[0] + py * view.C[1] + pz * view.C[2];
      if (facing < 0.05 || !proj(cam, px, py, pz, OUT)) continue;
      const v = 0.5 * facing * o.body / 6;
      SPL.blob(OUT[0], OUT[1], R * 0.28 + 1, v, v * 0.97, v * 0.92);
    }
  }
  SOFT.flush(ctx);
  SPL.flush(ctx);

  // the flash when the beam sweeps past us
  const F = beamFlash(view, o.alpha, o.rho, phase, rate) * o.flash;
  if (F > 0.002) {
    sprite(ctx, GLOW.white, sx, sy, R * (4 + 8 * F), F);
    sprite(ctx, o.haloSprite || GLOW.ice, sx, sy, R * (10 + 14 * F), 0.45 * F);
  }
  return { sx, sy, R, F, cam, view };
}

// ------------------------------------------------------------------ headlines

// Each word rises into place from behind a mask. Emphasis is italic and coloured.
const HEADLINES = [
  { t: [T.tick0, T.s2 - 0.2], exit: 0.22, stag: 0.012, x: 118, y: 408, size: 138, lh: 0.96, kick: [0.62, '12 PULSARS · REAL SPIN RATES · LIVE SOUND'],
    lines: [['Dead', 'stars'], ['that', 'still', 'keep'], ['perfect', '*time.*']], at: [T.tick0, T.tick0 + P0, T.tick0 + 2 * P0] },
  { t: [T.s2 + 0.14, T.s3 - 0.1], x: 118, y: 212, size: 82, lh: 1.02,
    lines: [['From', 'a', 'heartbeat'], ['to', 'a', '*musical*', '*note.*']] },
  { t: [T.s3 + 0.34, T.edge + 0.18], x: 118, y: 212, size: 88, lh: 1.02,
    lines: [['Fly', 'between', 'them'], ['across', 'the', '*Milky*', '*Way.*']] },
  { t: [T.s4 + 0.16, T.s5 - 0.1], x: 118, y: 470, size: 92, lh: 1.02,
    lines: [['See', 'every', 'pulse'], ['*as*', '*you*', '*hear*', '*it.*']] },
  { t: [T.s5 + 0.1, T.glitch - 0.2], exit: 0.18, stag: 0.012, x: 118, y: 600, size: 96, lh: 1.02, accent: COL.amber, kick: [0, 'CRAB · SEEN FROM EARTH IN 1054'],
    lines: [['Replay', 'the'], ['*supernova.*']] },
  { t: [T.glitch + 0.1, T.sky - 0.2], exit: 0.18, stag: 0.012, x: 118, y: 600, size: 96, lh: 1.02, accent: COL.violet, kick: [0, 'VELA · A STARQUAKE, SEEN AND HEARD'],
    lines: [['Trigger', 'a'], ['*starquake.*']] },
  { t: [T.sky + 0.1, T.s6 - 0.14], exit: 0.2, stag: 0.012, x: 118, y: 600, size: 96, lh: 1.02, kick: [0, '5,000 NAKED-EYE STARS · REAL POSITIONS'],
    lines: [['Find', 'them', 'in'], ['*your*', '*sky.*']] },
];

function drawHeadline(ctx, h, t) {
  if (t < h.t[0] - 0.05 || t > h.t[1] + 0.6) return;
  const accent = h.accent || COL.ice;
  let wi = 0, total = h.lines.flat().length;
  h.lines.forEach((line, li) => {
    const y = h.y + li * h.size * h.lh;
    let x = h.x;
    const start = h.at ? h.at[li] : h.t[0] + li * 0.1;
    line.forEach((raw, k) => {
      const em = raw.startsWith('*');
      const word = em ? raw.slice(1, -1) : raw;
      const f = em ? font(400, h.size, SERIF, true) : font(300, h.size, SERIF);
      const w = measure(ctx, word, f);
      const s = start + k * 0.055;
      const p = P(t, s, s + 0.62, E.outExpo);
      const st = h.stag ?? 0.022, ex = h.exit ?? 0.32;
      const q = P(t, h.t[1] + (total - 1 - wi) * st, h.t[1] + (total - 1 - wi) * st + ex, E.inCubic);
      if (p > 0 && q < 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 12, y - h.size * 1.02, w + 30, h.size * 1.32);
        ctx.clip();
        const dy = (1 - p) * h.size * 0.95 - q * h.size * 1.05;
        text(ctx, word, x, y + dy, f, em ? accent : COL.ink);
        ctx.restore();
      }
      x += w + h.size * 0.24;
      wi++;
    });
  });
  if (h.kick) {
    const [delay, str] = h.kick;
    const p = P(TF, h.t[0] + delay, h.t[0] + delay + 0.5);
    const q = P(t, h.t[1], h.t[1] + (h.exit ?? 0.25));
    if (p > 0 && q < 1) {
      ctx.globalAlpha = 1 - q;
      text(ctx, scramble(str, p, 5), h.x + 4, h.y - h.size * 0.8 - 24, font(500, 15, MONO), COL.amber, 'left', 3.6);
      ctx.globalAlpha = 1;
    }
  }
}

// ------------------------------------------------------------------ 01 + 02: the heartbeat and the spin-up

function ticked(t, times, len) {           // 1 on a tick, decaying over len seconds
  let v = 0;
  for (const tt of times) if (t >= tt && t < tt + len * 4) v = Math.max(v, Math.exp(-(t - tt) / len));
  return v;
}
const HEART = [0, 1, 2, 3].map((k) => T.tick0 + k * P0);

function mainPulsarState(t) {
  const rate = spinRate(t), phase = spinPhase(t);
  const lr = Math.log10(rate);
  const warm = sstep(1.1, 2.7, lr);                     // B0329's teal hands over to J1748's gold
  const inS2 = P(t, T.s2 - 0.02, T.s2 + 0.5, E.outExpo);
  const out = P(t, T.s3 - 0.02, T.s3 + 0.36, E.inCubic);   // the fly-out to the galaxy
  const punch = 0.028 * ticked(t, HEART, 0.09);
  const dist = lerp(15.5 - 1.4 * P(t, 0, T.s2, E.inOutSine), 17.5, inS2) * (1 - punch) * Math.pow(160, out);
  return {
    rate, phase, lr, warm, inS2, out,
    zeta: lerp(57 * DEG, 79 * DEG, sstep(0.15, 0.75, lr) * inS2),
    az: -0.35 + 0.16 * t,
    roll: lerp(-13, -9, inS2) * DEG,
    cx: lerp(1236, 1400, inS2), cy: lerp(540, 452, inS2),
    dist,
  };
}

function drawMain(ctx, t) {
  if (t > T.s3 + 0.62) return null;
  const s = mainPulsarState(t);
  const fadeIn = P(t, 0, 0.3);
  const beam = mix3(MAIN.vis.beam, FAST.vis.beam, s.warm), halo = mix3(MAIN.vis.halo, FAST.vis.halo, s.warm);
  const d0 = mainPulsarState(t - SL / 2).dist, d1 = mainPulsarState(t + SL / 2).dist;
  const r = drawPulsar(ctx, t, {
    dist: s.dist, distA: d0, distB: d1, zeta: s.zeta, az: s.az, roll: s.roll, cx: s.cx, cy: s.cy, focal: 900,
    alpha: 54 * DEG, rho: 10 * DEG, length: 26, phase: s.phase, rate: s.rate,
    beam, halo, surf: mix3(MAIN.vis.surf, FAST.vis.surf, s.warm),
    haloSprite: s.warm < 0.5 ? GLOW.ice : GLOW.amber,
    body: fadeIn * (1 - P(t, T.s3 + 0.2, T.s3 + 0.55)),
    beamGain: fadeIn * (1 + 0.25 * sstep(1.2, 2.8, s.lr)) * (1 - P(t, T.s3, T.s3 + 0.3)),
    field: 0.34 * fadeIn * (1 - sstep(0.25, 0.6, s.lr)) * (1 - s.inS2 * 0.4),
    // Full flashes only while the beats are slow; faster, the star just glows (no strobing).
    flash: fadeIn * lerp(1, 0.12, sstep(0.2, 0.55, s.lr)),
    stars: fadeIn * (1 - P(t, T.s3 + 0.35, T.s3 + 0.6)),
    neb: [[NEB.main, 0.55 * fadeIn * (1 - s.warm) * (1 - s.out)], [NEB.fast, 0.6 * s.warm * (1 - s.out)]],
    nebScale: 1 + 2 * s.out,
  });
  return r;
}

// The tuning dial, as on the site's console: spin rate on a log scale, 0.01 to 1000 turns a second.
const DIAL = { x0: 150, x1: 1770, y: 968, lo: -2, hi: 3 };
const dialX = (f) => DIAL.x0 + ((Math.log10(f) - DIAL.lo) / (DIAL.hi - DIAL.lo)) * (DIAL.x1 - DIAL.x0);
const ROW = { J0901: 0, B1919: 0, B0329: 1, B0950: 0, Vela: 0, B1913: 1, Crab: 0, J0737A: 1, B1257: 0, J0437: 1, B1937: 0, J1748ad: 1 };
const HEAR = [[0, 'a slow heartbeat'], [0.35, 'quickening beats'], [1, 'a flutter'], [1.301, 'a buzz'], [2.0, 'a rising tone'], [2.8545, 'a tone near F5 (+44 cents)']];

function drawDial(ctx, t) {
  const a = P(t, T.s2 + 0.04, T.s2 + 0.5, E.outCubic);
  const out = P(t, T.s3 - 0.12, T.s3 + 0.3, E.inCubic);
  if (a <= 0 || out >= 1) return;
  const dy = out * 150, y = DIAL.y + dy;
  ctx.globalAlpha = 1 - out;
  // baseline draws on from the left
  const xr = lerp(DIAL.x0, DIAL.x1, P(t, T.s2 + 0.04, T.s2 + 0.62, E.outExpo));
  ctx.fillStyle = COL.line2;
  ctx.fillRect(DIAL.x0, y, xr - DIAL.x0, 1.5);
  // zones: beats, flutter, tones
  const z10 = dialX(10), z20 = dialX(20);
  ctx.fillStyle = 'rgba(255,181,71,0.3)';
  if (xr > z10) ctx.fillRect(z10, y - 2, Math.min(xr, z20) - z10, 5);
  [[DIAL.x0, 'BEATS'], [z10, 'FLUTTER'], [z20, 'TONES']].forEach(([x, s], i) => {
    const p = P(TF, T.s2 + 0.25 + i * 0.1, T.s2 + 0.6 + i * 0.1);
    if (p > 0) text(ctx, scramble(s, p, 11 + i), x + 6, y + 34, font(500, 12, MONO), COL.ink3, 'left', 2.4);
  });
  // ticks
  for (let d = DIAL.lo; d < DIAL.hi; d++) {
    for (let m = 1; m < 10; m++) {
      const f = m * 10 ** d, x = dialX(f);
      if (x > xr) break;
      const major = m === 1;
      ctx.fillStyle = major ? COL.line2 : COL.line;
      ctx.fillRect(x, y - (major ? 12 : 6), 1, major ? 24 : 12);
      if (major) {
        const lab = d === 0 ? '1 Hz' : d === 3 ? '1k' : d < 0 ? String(10 ** d) : String(10 ** d);
        text(ctx, lab, x + 5, y + 16, font(400, 12, MONO), COL.ink3);
      }
    }
  }
  ctx.fillStyle = COL.line2;
  if (xr >= DIAL.x1) ctx.fillRect(DIAL.x1, y - 12, 1, 24);
  // stations
  const f = spinRate(t), nx = dialX(f);
  for (const st of STATIONS) {
    const p = st.p, x = dialX(p.f);
    if (x > xr) continue;
    const passed = t >= T.s2 && f >= p.f * 0.9999;
    const hit = st.t > 0 ? Math.exp(-Math.max(0, t - st.t) / 0.18) * (t >= st.t ? 1 : 0) : 0;
    const on = passed ? 1 : 0;
    const ly = y - (ROW[p.short] ? 28 : 50);
    ctx.fillStyle = on ? COL.amber : 'rgba(170,179,199,0.65)';
    ctx.beginPath();
    ctx.arc(x, y, 3.4 + 3 * hit, 0, TAU);
    ctx.fill();
    if (hit > 0.02) {
      ctx.strokeStyle = rgba(COL.amber, 0.8 * hit);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 6 + 26 * (1 - hit), 0, TAU);
      ctx.stroke();
      sprite(ctx, GLOW.amber, x, y, 30, 0.6 * hit);
    }
    ctx.fillStyle = COL.line;
    ctx.fillRect(x, ly + 6, 1, y - ly - 10);
    text(ctx, p.label, x, ly, font(500, 12, MONO), on ? COL.amber : COL.ink2, 'center', 1.2);
  }
  // the needle
  if (t >= T.s2 - 0.02) {
    const na = P(t, T.s2 + 0.2, T.s2 + 0.45);
    ctx.globalAlpha = (1 - out) * na;
    sprite(ctx, GLOW.ember, nx, y - 10, 46, 0.55);
    ctx.fillStyle = COL.ember;
    ctx.fillRect(nx - 1.25, y - 64, 2.5, 84);
    ctx.beginPath();
    ctx.moveTo(nx - 7, y - 72); ctx.lineTo(nx + 7, y - 72); ctx.lineTo(nx, y - 62); ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// The chart recorder: the last two seconds of ticks. Slow ones are single spikes;
// faster, they crowd together, and at 716 a second they are one solid band: a note.
const TRACE = { x0: 150, x1: 1770, y: 862, h: 52, span: 2.2 };
function drawTrace(ctx, t) {
  const a = P(t, T.s2 + 0.1, T.s2 + 0.55, E.outCubic) * (1 - P(t, T.s3 - 0.1, T.s3 + 0.25));
  if (a <= 0) return;
  const cols = TRACE.x1 - TRACE.x0;
  const reveal = P(t, T.s2 + 0.1, T.s2 + 0.7, E.outExpo);
  ctx.fillStyle = rgba(COL.ice, 0.1 * a);
  ctx.fillRect(TRACE.x0, TRACE.y, cols, 1);
  let prevPh = spinPhase(t - TRACE.span);
  ctx.globalAlpha = a;
  for (let c = 1; c <= cols; c++) {
    if (c < cols * (1 - reveal)) { prevPh = spinPhase(t - TRACE.span * (1 - c / cols)); continue; }
    const tc = t - TRACE.span * (1 - c / cols);
    if (tc < T.tick0 - 0.3) { prevPh = spinPhase(tc); continue; }
    const ph = spinPhase(tc);
    const rate = spinRate(tc);
    let v;
    if (Math.floor(ph) !== Math.floor(prevPh)) v = 1;
    else {
      const d = Math.min(ph - Math.floor(ph), Math.ceil(ph) - ph) / rate;   // seconds to the nearest tick
      v = Math.exp(-((d / 0.004) ** 2));
    }
    prevPh = ph;
    if (v < 0.02) continue;
    const age = 1 - c / cols;
    ctx.fillStyle = age < 0.02 ? COL.amber : rgba(COL.ice, 0.35 + 0.65 * (1 - age));
    ctx.fillRect(TRACE.x0 + c - 1, TRACE.y - v * TRACE.h, 1, v * TRACE.h);
  }
  ctx.globalAlpha = 1;
  // the pen
  sprite(ctx, GLOW.amber, TRACE.x1, TRACE.y, 22, 0.8 * a);
}

// A number whose digits roll like a mechanical counter: each digit turns over while the
// digit to its right goes from 9 to 0. The last digit just flips.
function odometer(ctx, value, x, y, f, size, color, decimals = 2) {
  const dw = measure(ctx, '0', f), pw = measure(ctx, '.', f);
  const n = value * 10 ** decimals;
  const total = Math.max(1, Math.floor(Math.log10(Math.max(1, value))) + 1) + decimals;
  const step = size * 0.8;
  let cx = x;
  for (let k = total - 1; k >= 0; k--) {
    const c = n / 10 ** k, fr = c - Math.floor(c);
    const d = Math.floor(c) % 10;
    const roll = k === 0 ? 0 : clamp((fr - 0.9) * 10);
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - 8, y - size * 0.74, dw + 16, size * 0.84);
    ctx.clip();
    text(ctx, String(d), cx, y - roll * step, f, color);
    if (roll > 0) text(ctx, String((d + 1) % 10), cx, y + (1 - roll) * step, f, color);
    ctx.restore();
    cx += dw;
    if (k === decimals) { text(ctx, '.', cx, y, f, color); cx += pw; }
  }
  return cx - x;
}
function stationAt(t) {
  let cur = MAIN;
  for (const st of STATIONS) if (st.t > 0 && t >= st.t) cur = st.p;
  return cur;
}
function drawReadout(ctx, t) {
  const a = P(t, T.s2 + 0.12, T.s2 + 0.62, E.outExpo);
  const out = P(t, T.s3 - 0.14, T.s3 + 0.26, E.inCubic);
  if (a <= 0 || out >= 1) return;
  const x = 118 - out * 60, dy = (1 - a) * 40;
  ctx.globalAlpha = a * (1 - out);
  const p = stationAt(TF);
  let since = T.s2;
  for (const st of STATIONS) if (st.t > 0 && TF >= st.t) since = st.t;
  const sp = P(TF, since, since + 0.16);
  text(ctx, scramble(p.name, sp, p.i + 3), x, 452 + dy, font(500, 42, MONO), COL.ink, 'left', 0.5);
  text(ctx, p.title, x, 504 + dy, font(400, 40, SERIF, true), rgba(COL.ink2, P(TF, since, since + 0.3)));
  // the big number, live
  const f = spinRate(TF);
  const nf = font(300, 214, NUM);
  sprite(ctx, GLOW.soft, x + 200, 640 + dy, 260, 0.12);
  // the live rate on an odometer (at the frame's own time, so every digit stays sharp)
  const nw = odometer(ctx, f, x - 6, 704 + dy, nf, 214, COL.ink);
  text(ctx, 'TURNS', x + nw + 16, 668 + dy, font(500, 15, MONO), COL.ink2, 'left', 3);
  text(ctx, 'PER SECOND', x + nw + 16, 694 + dy, font(500, 15, MONO), COL.ink2, 'left', 3);
  // what you hear
  const lr = Math.log10(f);
  let hear = HEAR[0], hi = 0;
  HEAR.forEach((hh, i) => { if (lr >= hh[0] - 1e-4) { hear = hh; hi = i; } });
  const tagF = font(500, 13, MONO);
  const tw = measure(ctx, 'YOU HEAR', tagF, 2.6) + 24;
  ctx.fillStyle = 'rgba(255,181,71,0.16)';
  ctx.beginPath();
  ctx.roundRect(x, 752 + dy, tw, 30, 5);
  ctx.fill();
  text(ctx, 'YOU HEAR', x + 12, 772 + dy, tagF, COL.amber, 'left', 2.6);
  const landed = t >= T.land - 0.02;
  text(ctx, hear[1], x + tw + 16, 776 + dy, font(landed ? 500 : 400, 27, SANS), landed ? COL.ice : COL.ink);
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ 03: the galaxy

const SUN = [-CAT.R_SUN_KPC, 0, 0.02];
const GPOS = PULSARS.map((p) => [p.g.x, p.g.y, p.g.z]);
// Where each label sits relative to its star, in pixels, so the Sun's crowd stays legible.
const LABEL_OFF = {
  J0901: [-14, 22, 'right'], B1919: [14, -12, 'left'], B0329: [-14, -12, 'right'], B0950: [14, -10, 'left'],
  Vela: [14, 18, 'left'], B1913: [14, -10, 'left'], Crab: [-14, 16, 'right'], J0737A: [-14, 20, 'right'],
  B1257: [14, -16, 'left'], J0437: [14, 26, 'left'], B1937: [14, -10, 'left'], J1748ad: [14, -12, 'left'],
};

const STACK_G = { cx: 1180, w: 640, y0: 846, gap: 11.6, amp: 72 };
function stackX(i) { return STACK_G.cx - STACK_G.w / 2 + (STACK_G.w * i) / (STACK.S - 1); }

function galaxyCam(t) {
  const p = P(t, T.s3 + 0.1, T.s3 + 1.2, E.outCubic);           // pull out from J1748
  const q = P(t, T.edge, T.s4 + 0.02, E.inOutCubic);           // tilt to edge-on for the match cut
  const drift = P(t, T.s3, T.s4, E.inOutSine);
  const tgt = V.lerp(V.lerp(GPOS[FAST.i], [-6.1, 0.8, 0], p), [0, 0, 0], q);
  const dist = Math.exp(lerp(lerp(Math.log(6.5), Math.log(13.5), p), Math.log(57), q));
  const el = lerp(lerp(76, 44, p), 0.25, q) * DEG;
  const az = lerp(lerp(-150, -106, p) + 8 * drift, -90, q) * DEG;
  const pos = V.add(tgt, [Math.cos(el) * Math.cos(az) * dist, Math.cos(el) * Math.sin(az) * dist, Math.sin(el) * dist]);
  const m = P(t, T.s3 + 0.1, T.s3 + 1.0, E.inOutCubic);
  const cx = lerp(lerp(1400, 1190, m), 1180, q);
  const cy = lerp(lerp(452, 610, m), STACK_G.y0, q);
  return camera(pos, tgt, [0, 0, 1], 1250, cx, cy);
}
const NEAR_SUN = ['J0901', 'B1919', 'B0950', 'Vela', 'J0737A', 'B1257', 'J0437'];
// The pulsars light up, and the flight path joins them, slowest to fastest.
const POP0 = T.s3 + 0.55, POP_DT = 0.06, ARC0 = T.s3 + 0.62, ARC_DT = 0.07, ARC_DUR = 0.36;

// The edge-on disc turns into the first pulse of the stack: its outline, in screen space.

function drawGalaxy(ctx, t) {
  const a = P(t, T.s3 + 0.08, T.s3 + 0.4, E.inQuad) * (1 - P(t, T.s4 + 0.08, T.s4 + 0.3));
  if (a <= 0) return;
  const camA = galaxyCam(t - SL / 2), camB = galaxyCam(t + SL / 2);
  const flat = P(t, T.s4 - 0.32, T.s4 + 0.04, E.inOutCubic);
  const gain = 0.9 * a;
  const line0 = STACK.lines[STACK.N - 1];
  const left = STACK_G.cx - STACK_G.w / 2;
  for (let i = 0, k = 0; k < GAL_N; i += 6, k++) {
    const h = hash(k + SK * 7919);
    if (!proj(camA, GALAXY[i], GALAXY[i + 1], GALAXY[i + 2], OUT) || !proj(camB, GALAXY[i], GALAXY[i + 1], GALAXY[i + 2], OUT2)) continue;
    let x = lerp(OUT[0], OUT2[0], h), y = lerp(OUT[1], OUT2[1], h);
    const z = lerp(OUT[2], OUT2[2], h);
    if (z < 0.02) continue;
    let b = gain * sstep(1.2, 4.5, z) * Math.min(2.5, 1.2 / Math.sqrt(z));
    if (flat > 0) {
      const u = (x - left) / STACK_G.w;
      const i2 = clamp(Math.round(u * (STACK.S - 1)), 0, STACK.S - 1);
      y = lerp(y, STACK_G.y0 - line0[i2] * STACK_G.amp, flat);
      if (u < 0 || u > 1) b *= 1 - flat;
    }
    const r = GALAXY[i + 3] * b, g = GALAXY[i + 4] * b, bl = GALAXY[i + 5] * b;
    SPL.pt(x, y, r, g, bl);
    if ((k & 3) === 0) SOFT.blob(x, y, 7, r * 0.05, g * 0.05, bl * 0.05);
  }
  SOFT.flush(ctx);
  SPL.flush(ctx);

  // markers, the flight path and labels
  const cam = galaxyCam(t);
  const la = P(t, T.s3 + 0.62, T.s3 + 0.9) * (1 - P(t, T.edge - 0.04, T.edge + 0.2));
  if (la <= 0) return;
  const order = PULSARS.slice().sort((p, q) => p.f - q.f);
  // the flight path, slowest to fastest, arcing above the disc
  ctx.lineWidth = 1.6;
  for (let i = 0; i < order.length - 1; i++) {
    const A = GPOS[order[i].i], B = GPOS[order[i + 1].i];
    const s0 = ARC0 + i * ARC_DT;
    const p = P(t, s0, s0 + ARC_DUR, E.inOutCubic);
    if (p <= 0) continue;
    const dist = V.len(V.sub(B, A));
    const mid = V.add(V.mul(V.add(A, B), 0.5), [0, 0, 0.2 + 0.32 * dist]);
    const n = 40, end = Math.round(n * p);
    const path = [];
    let head = null;
    for (let s = 0; s <= end; s++) {
      const u = s / n;
      const x = (1 - u) * (1 - u) * A[0] + 2 * (1 - u) * u * mid[0] + u * u * B[0];
      const y = (1 - u) * (1 - u) * A[1] + 2 * (1 - u) * u * mid[1] + u * u * B[1];
      const z = (1 - u) * (1 - u) * A[2] + 2 * (1 - u) * u * mid[2] + u * u * B[2];
      if (!proj(cam, x, y, z, OUT)) continue;
      path.push(OUT[0], OUT[1]);
      head = [OUT[0], OUT[1]];
    }
    for (const [w, al] of [[6, 0.14], [1.8, 0.85]]) {
      ctx.lineWidth = w;
      ctx.strokeStyle = rgba(COL.amber, al * la);
      ctx.beginPath();
      for (let s = 0; s < path.length; s += 2) { if (s === 0) ctx.moveTo(path[0], path[1]); else ctx.lineTo(path[s], path[s + 1]); }
      ctx.stroke();
    }
    if (head && p < 1) sprite(ctx, GLOW.white, head[0], head[1], 22, la);
    if (head && p < 1) sprite(ctx, GLOW.amber, head[0], head[1], 44, la);
  }
  // the pulsars light up in the same order
  const pos = [];
  order.forEach((p, k) => {
    if (!proj(cam, GPOS[p.i][0], GPOS[p.i][1], GPOS[p.i][2], OUT)) return;
    const s0 = POP0 + k * POP_DT;
    if (t < s0) return;
    const pop = spring(t - s0, 22, 0.45);
    const x = OUT[0], y = OUT[1];
    pos[p.i] = [x, y];
    ctx.globalAlpha = la;
    sprite(ctx, p === FAST ? GLOW.amber : GLOW.ice, x, y, 26 * pop, 1);
    ctx.strokeStyle = rgba(COL.ink, 0.45);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, 4 + 8 * pop, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
  // labels: the far ones by their stars, the Sun's neighbours in a list
  ctx.globalAlpha = la;
  order.forEach((p, k) => {
    if (!pos[p.i] || NEAR_SUN.includes(p.short)) return;
    const s0 = POP0 + k * POP_DT;
    const [x, y] = pos[p.i];
    const [ox, oy, al] = LABEL_OFF[p.short];
    text(ctx, scramble(p.label, P(TF, s0, s0 + 0.3), p.i + 40), x + ox, y + oy, font(500, p === FAST ? 17 : 15, MONO), p === FAST ? COL.amber : COL.ink, al, 1.6);
  });
  if (proj(cam, SUN[0], SUN[1], SUN[2], OUT)) {
    const sp = P(t, T.s3 + 0.55, T.s3 + 0.85);
    const x = OUT[0], y = OUT[1];
    ctx.globalAlpha = la * sp;
    sprite(ctx, GLOW.amber, x, y, 18, 1);
    ctx.fillStyle = COL.amber;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, TAU);
    ctx.fill();
    // the list hangs below-left of the Sun, on a leader line
    const lx = x - 150, ly = y + 70;
    const lp = P(t, T.s3 + 0.8, T.s3 + 1.15, E.outCubic);
    ctx.strokeStyle = rgba(COL.amber, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - 4, y + 4);
    ctx.lineTo(lerp(x - 4, lx + 6, lp), lerp(y + 4, ly - 18, lp));
    ctx.stroke();
    text(ctx, 'SUN', x + 14, y + 5, font(500, 14, MONO), COL.amber, 'left', 2);
    const lt = P(TF, T.s3 + 0.9, T.s3 + 1.25);
    text(ctx, scramble('NEAR THE SUN', lt, 71), lx, ly, font(500, 13, MONO), COL.amber, 'right', 2.2);
    NEAR_SUN.forEach((s, i) => {
      const q = P(TF, T.s3 + 0.95 + i * 0.03, T.s3 + 1.25 + i * 0.03);
      text(ctx, scramble(BY_ID[s].label, q, 80 + i), lx, ly + 22 + i * 20, font(500, 13, MONO), COL.ink2, 'right', 1.6);
    });
  }
  ctx.globalAlpha = 1;
  // a caption under the headline
  const cp = P(TF, T.s3 + 1.1, T.s3 + 1.6);
  if (cp > 0) {
    ctx.globalAlpha = la;
    text(ctx, scramble('REAL POSITIONS · ATNF PULSAR CATALOGUE', cp, 77), 122, 330, font(500, 13, MONO), COL.ink3, 'left', 2.6);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ 04: the instruments

// Newest pulse at the bottom, as on the site. Lines arrive faster and faster.
const ARRIVE = Array.from({ length: STACK.N }, (_, j) => T.s4 + 0.04 + 1.08 * Math.pow(j / (STACK.N - 1), 0.62));
const CLOCK = { cx: 1180, cy: 572, r0: 214 };
const FOLD = { t0: T.fold, collapse: 0.34, bend: [T.fold + 0.26, T.fold + 0.7] };
const HAND0 = T.fold + 0.66;                     // the clock hand starts on a pulse

// A point of a pulse line, as the stack folds into the clock: the line bends into an
// arc of the dial (keeping its middle, the pulse, at the top) while it shrinks to the
// slice of a turn it really covers. amp is the pulse height, outward from the dial.
function foldPoint(i, amp, base, bend, out) {
  const L = lerp(STACK_G.w, 2 * STACK.win * TAU * CLOCK.r0, bend);
  const s = (i / (STACK.S - 1) - 0.5) * L;
  const k = bend / CLOCK.r0;
  const mx = STACK_G.cx + (CLOCK.cx - STACK_G.cx) * bend, my = lerp(base, CLOCK.cy - CLOCK.r0, bend);
  if (k < 1e-7) { out[0] = mx + s; out[1] = my - amp; return; }
  const a = k * s, sn = Math.sin(a), cs = Math.cos(a);
  out[0] = mx + sn / k + sn * amp;
  out[1] = my + (1 - cs) / k - cs * amp;
}

function drawInstruments(ctx, t) {
  const a = P(t, T.s4 - 0.04, T.s4 + 0.02) * (1 - P(t, T.s5 - 0.02, T.s5 + 0.1));
  if (a <= 0) return;
  let n = 0;
  for (const at of ARRIVE) if (t >= at) n++;
  let scroll = 0;
  for (let j = 1; j < STACK.N; j++) scroll += P(t, ARRIVE[j], ARRIVE[j] + 0.07, E.outCubic);
  const bend = P(t, FOLD.bend[0], FOLD.bend[1], E.inOutCubic);
  const S = STACK.S;
  const pts = new Float32Array(S * 2);
  const fillIn = P(t, T.s4 + 0.15, T.s4 + 0.35);
  // oldest (top) first, each filled black underneath so it hides the lines behind it
  for (let idx = n - 1; idx >= 0; idx--) {
    const arrived = ARRIVE[idx];
    const rise = scroll - idx;                     // how many places above the bottom
    const c0 = FOLD.t0 + 0.12 * clamp(rise / (STACK.N - 1));
    const col = P(t, c0, c0 + FOLD.collapse - 0.12, E.inOutCubic);   // falls onto the bottom line
    const yb = STACK_G.y0 - rise * STACK_G.gap * (1 - col);
    const v = STACK.lines[STACK.N - 1 - idx];
    const draw = idx === 0 ? 1 : P(t, arrived, arrived + 0.08);
    const upto = Math.max(2, Math.round(S * draw));
    for (let i = 0; i < S; i++) {
      foldPoint(i, Math.min(v[i], 2.6) * STACK_G.amp * (1 + 0.25 * bend), yb, bend, OUT);
      pts[i * 2] = OUT[0];
      pts[i * 2 + 1] = OUT[1];
    }
    const fillA = fillIn * (1 - col);
    if (fillA > 0.01) {
      ctx.fillStyle = `rgba(0,0,0,${fillA})`;
      ctx.beginPath();
      ctx.moveTo(pts[0], yb + 2);
      for (let i = 0; i < upto; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
      ctx.lineTo(pts[(upto - 1) * 2], yb + 2);
      ctx.closePath();
      ctx.fill();
    }
    const fresh = Math.exp(-Math.max(0, t - arrived) / 0.35);
    const la = a * lerp(0.94, 0.16, col);
    ctx.strokeStyle = css3(mix3([0.914, 0.93, 0.965], [0.62, 0.9, 1.0], fresh), la);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < upto; i++) {
      if (i === 0) ctx.moveTo(pts[0], pts[1]); else ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
    }
    ctx.stroke();
  }
  // labels over the stack
  const top = STACK_G.y0 - (STACK.N - 1) * STACK_G.gap - 2.6 * STACK_G.amp - 36;
  const lab = P(TF, T.s4 + 0.3, T.s4 + 0.7) * (1 - P(t, FOLD.t0 - 0.05, FOLD.t0 + 0.12));
  if (lab > 0) {
    ctx.globalAlpha = a * Math.min(1, lab * 2);
    text(ctx, scramble('SINGLE PULSES · CP 1919', lab, 61), STACK_G.cx - STACK_G.w / 2, top, font(500, 14, MONO), COL.ink2, 'left', 2.8);
    text(ctx, scramble('1 LINE = 1 TURN', lab, 62), STACK_G.cx + STACK_G.w / 2, top, font(500, 14, MONO), COL.ink3, 'right', 2.8);
    ctx.globalAlpha = 1;
  }
  // the folded profile: the average of every turn, steady where single pulses are not
  const mp = P(t, FOLD.t0 + 0.12, FOLD.t0 + 0.4, E.outCubic);
  if (mp > 0) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgba(COL.ice, a * mp);
    ctx.beginPath();
    for (let i = 0; i < S; i++) {
      foldPoint(i, Math.min(STACK.mean[i], 2.6) * STACK_G.amp * (1 + 0.25 * bend), STACK_G.y0, bend, OUT);
      if (i === 0) ctx.moveTo(OUT[0], OUT[1]); else ctx.lineTo(OUT[0], OUT[1]);
    }
    ctx.stroke();
  }
  // the rest of the turn closes into a dial
  if (bend > 0.6) {
    const ca = a * P(bend, 0.6, 1);
    const half = STACK.win * TAU;
    ctx.globalAlpha = ca;
    ctx.strokeStyle = rgba(COL.ice, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(CLOCK.cx, CLOCK.cy, CLOCK.r0, -Math.PI / 2 + half, -Math.PI / 2 + half + (TAU - 2 * half) * P(bend, 0.6, 1, E.outCubic));
    ctx.stroke();
    ctx.strokeStyle = COL.line2;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let k = 0; k < 60; k++) {
      const th = (k / 60) * TAU, long = k % 5 === 0;
      const r1 = CLOCK.r0 - 22, r2 = r1 - (long ? 18 : 9);
      ctx.moveTo(CLOCK.cx + Math.sin(th) * r1, CLOCK.cy - Math.cos(th) * r1);
      ctx.lineTo(CLOCK.cx + Math.sin(th) * r2, CLOCK.cy - Math.cos(th) * r2);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // the hand turns once per rotation, at CP 1919's true period
  const hp = P(t, HAND0 - 0.2, HAND0 + 0.05);
  if (hp > 0) {
    const handA = Math.max(0, t - HAND0) / CP1919.P * TAU;
    const beat = Math.exp(-((((handA / TAU) % 1) * CP1919.P) / 0.1));
    ctx.globalAlpha = a * hp;
    ctx.strokeStyle = COL.amber;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CLOCK.cx, CLOCK.cy);
    ctx.lineTo(CLOCK.cx + Math.sin(handA) * (CLOCK.r0 - 46), CLOCK.cy - Math.cos(handA) * (CLOCK.r0 - 46));
    ctx.stroke();
    sprite(ctx, GLOW.amber, CLOCK.cx, CLOCK.cy, 34 + 30 * beat, 0.9);
    ctx.fillStyle = COL.amber;
    ctx.beginPath();
    ctx.arc(CLOCK.cx, CLOCK.cy, 7, 0, TAU);
    ctx.fill();
    // the pulse lights up each time the hand passes it
    sprite(ctx, GLOW.ice, CLOCK.cx, CLOCK.cy - CLOCK.r0 - 60, 120, 0.7 * beat);
    ctx.globalAlpha = 1;
  }
  const cl = P(TF, FOLD.t0 + 0.4, FOLD.t0 + 0.8);
  if (cl > 0) {
    ctx.globalAlpha = a;
    text(ctx, scramble('ROTATION CLOCK', cl, 63), STACK_G.cx - STACK_G.w / 2, top, font(500, 14, MONO), COL.ink2, 'left', 2.8);
    text(ctx, `${Math.round(STACK.N * cl)} TURNS FOLDED`, STACK_G.cx + STACK_G.w / 2, top, font(500, 14, MONO), COL.ink3, 'right', 2.8);
    text(ctx, 'PULSE', CLOCK.cx + 44, CLOCK.cy - CLOCK.r0 - 64, font(500, 13, MONO), COL.ink2, 'left', 2.6);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ 05: supernova, glitch, sky

// The supernova of 1054, replayed: a thin hot shell, fingers of debris behind it,
// and the Crab Nebula's blue synchrotron glow filling in around the newborn pulsar.
const EJECTA = (() => {
  const r = rng(1054), out = [];
  for (let i = 0; i < 2800; i++) {                        // the shell
    const d = V.norm([gaussRand(r), gaussRand(r) * 0.86, gaussRand(r)]);
    out.push(d[0], d[1], d[2], 0.92 + 0.1 * r(), r(), 0);
  }
  for (let f = 0; f < 130; f++) {                         // filaments
    const d = V.norm([gaussRand(r), gaussRand(r) * 0.86, gaussRand(r)]);
    const len = 0.2 + 0.45 * r(), n = 14 + Math.floor(r() * 26), hue = r();
    for (let j = 0; j < n; j++) {
      const dd = V.norm([d[0] + gaussRand(r) * 0.022, d[1] + gaussRand(r) * 0.022, d[2] + gaussRand(r) * 0.022]);
      out.push(dd[0], dd[1], dd[2], 0.97 - len * Math.pow(r(), 0.7), hue, 1);
    }
  }
  return new Float32Array(out);
})();
const SYNC = (() => {
  const r = rng(531), out = [];
  for (let i = 0; i < 380; i++) {
    const d = V.norm([gaussRand(r), gaussRand(r) * 0.8, gaussRand(r)]);
    out.push(d[0], d[1], d[2], Math.pow(r(), 0.45) * 0.7, r());
  }
  return new Float32Array(out);
})();
const snRadius = (u) => 5.6 * (1 - Math.exp(-u / 0.22)) + 0.7 * u;
function drawSupernova(ctx, t) {
  const a = P(t, T.s5 - 0.01, T.s5 + 0.02) * (1 - P(t, T.glitch - 0.02, T.glitch + 0.02));
  if (a <= 0) return;
  const u = Math.max(0, t - T.s5);
  const shake = Math.exp(-u / 0.16) * 16;
  const sx = (noise(t * 40, 3) - 0.5) * shake, sy = (noise(t * 40, 7) - 0.5) * shake;
  ctx.globalAlpha = 0.42 * P(t, T.s5 + 0.15, T.s5 + 0.7);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(NEB.crab, -80, -60, W + 160, H + 120);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  const az = 0.4 + u * 0.3, cd = 12 - 1.2 * u;
  const cam = camera([Math.sin(az) * cd, 2.2, Math.cos(az) * cd], [0, 0, 0], [0, 1, 0], 1000, 1180 + sx, 540 + sy);
  for (let i = 0, k = 0; i < EJECTA.length; i += 6, k++) {
    const hj = hash(k + SK * 7919);
    const uu = Math.max(0, u + (hj - 0.5) * SL);
    const rr = snRadius(uu) * EJECTA[i + 3];
    if (!proj(cam, EJECTA[i] * rr, EJECTA[i + 1] * rr, EJECTA[i + 2] * rr, OUT)) continue;
    let c, b, sig;
    if (EJECTA[i + 5] === 0) {
      const heat = Math.exp(-uu / 0.12);
      c = heat > 0.35 ? mix3([1.0, 0.8, 0.5], [1, 0.97, 0.92], heat) : mix3([1.0, 0.72, 0.35], [1.0, 0.45, 0.28], clamp((uu - 0.15) / 0.5));
      b = (0.1 + 0.9 * heat) * (0.6 + 0.4 * EJECTA[i + 4]) * a;
      sig = 0.9;
    } else {
      const form = sstep(0.04, 0.4, uu);
      c = mix3([1.0, 0.75, 0.42], EJECTA[i + 4] < 0.55 ? [1.0, 0.4, 0.22] : [1.0, 0.45, 0.62], clamp(uu / 0.55));
      b = 0.3 * form * a;
      sig = 1.15;
    }
    SPL.blob(OUT[0], OUT[1], sig, c[0] * b, c[1] * b, c[2] * b);
  }
  // the synchrotron glow, blue-white, powered by the pulsar
  const sg = sstep(0.22, 0.65, u) * a;
  if (sg > 0) {
    const R = snRadius(u);
    for (let i = 0; i < SYNC.length; i += 5) {
      const rr = R * SYNC[i + 3];
      if (!proj(cam, SYNC[i] * rr, SYNC[i + 1] * rr, SYNC[i + 2] * rr, OUT)) continue;
      const v = 0.016 * sg * (0.5 + SYNC[i + 4]);
      SOFT.blob(OUT[0], OUT[1], 20 + 28 * SYNC[i + 4], 0.5 * v, 0.68 * v, v);
    }
  }
  SOFT.flush(ctx);
  SPL.flush(ctx);
  // the shock front, just ahead of the debris
  proj(cam, 0, 0, 0, OUT);
  const cx = OUT[0], cy = OUT[1];
  const rs = (snRadius(u) * 1.08 * cam.focal) / cd;
  ctx.strokeStyle = rgba('#ffe4bf', 0.6 * Math.exp(-u / 0.3) * a);
  ctx.lineWidth = 1.5 + 5 * Math.exp(-u / 0.15);
  ctx.beginPath();
  ctx.arc(cx, cy, rs, 0, TAU);
  ctx.stroke();
  sprite(ctx, GLOW.white, cx, cy, 50 + 420 * Math.exp(-u / 0.07), Math.exp(-u / 0.14) * a);
  sprite(ctx, GLOW.amber, cx, cy, 220, 0.55 * Math.exp(-u / 0.5) * a);
  // the newborn pulsar at the centre, its beams a blur at 30 turns a second
  const bp = P(t, T.s5 + 0.3, T.s5 + 0.5) * a;
  if (bp > 0) {
    sprite(ctx, GLOW.ice, cx, cy, 46, bp);
    ctx.strokeStyle = rgba('#dff6ff', 0.16 * bp);
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let j = 0; j < 8; j++) {
      const an = TAU * CRAB.f * (t + ((j + 0.5) / 8 - 0.5) * SL) , ex = Math.cos(an) * 70, ey = Math.sin(an) * 70 * 0.3 + 60;
      ctx.moveTo(cx - ex * 0.2, cy - ey); ctx.lineTo(cx + ex * 0.2, cy + ey);
    }
    ctx.stroke();
    ctx.fillStyle = rgba('#ffffff', bp);
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, TAU);
    ctx.fill();
  }
}

// Vela's starquake: the spin suddenly jumps, then relaxes. The site exaggerates it
// about ten-thousand-fold so you can hear it; so does this.
function velaRate(t) {
  const f0 = VELA.f;
  if (t < T.quake) return f0;
  return f0 * (1 + 0.01 * Math.exp(-(t - T.quake) / 1.6));
}
function velaPhase(t) {
  const f0 = VELA.f;
  if (t < T.quake) return (t - T.quake) * f0;
  const u = t - T.quake;
  return u * f0 + 0.01 * f0 * 1.6 * (1 - Math.exp(-u / 1.6));
}
function drawGlitch(ctx, t) {
  const a = P(t, T.glitch - 0.01, T.glitch + 0.02) * (1 - P(t, T.sky - 0.02, T.sky + 0.02));
  if (a <= 0) return;
  const u = t - T.quake;
  const kick = u > 0 ? Math.exp(-u / 0.12) : 0;
  const shake = kick * 16;
  const r = drawPulsar(ctx, t, {
    dist: 17 - 1.2 * P(t, T.glitch, T.sky), zeta: 92 * DEG, az: 0.8 + 0.25 * (t - T.glitch), roll: 8 * DEG,
    cx: 1180 + (noise(t * 50, 3) - 0.5) * shake, cy: 540 + (noise(t * 50, 5) - 0.5) * shake, focal: 900,
    alpha: 38 * DEG, rho: 9 * DEG, length: 24, phase: velaPhase(t), rate: velaRate(t),
    beam: VELA.vis.beam, halo: VELA.vis.halo, surf: VELA.vis.surf, haloSprite: GLOW.violet,
    body: a, beamGain: a * 0.8, field: 0.12 * a, flash: 0, stars: a,
    neb: [[NEB.vela, 0.62 * a]],
  });
  if (u > 0) {
    // the shock ring
    const rr = r.R * (1.4 + 16 * E.outExpo(clamp(u / 0.7)));
    ctx.strokeStyle = rgba('#efe2ff', 0.8 * Math.exp(-u / 0.3) * a);
    ctx.lineWidth = 2 + 10 * kick;
    ctx.beginPath();
    ctx.ellipse(r.sx, r.sy, rr, rr * 0.92, 0.2, 0, TAU);
    ctx.stroke();
    sprite(ctx, GLOW.violet, r.sx, r.sy, r.R * 40 * (0.4 + kick), 0.9 * kick * a);
    sprite(ctx, GLOW.white, r.sx, r.sy, r.R * 12, 0.9 * kick * a);
  }
  // the readout
  const ra = P(t, T.glitch + 0.12, T.glitch + 0.4) * a;
  if (ra > 0) {
    ctx.globalAlpha = ra;
    const f = velaRate(TF);
    text(ctx, 'VELA PULSAR', 1480, 380, font(500, 14, MONO), COL.ink2, 'left', 2.8);
    text(ctx, f.toFixed(3), 1478, 470, font(300, 96, NUM), u > 0 ? '#e6d6ff' : COL.ink);
    text(ctx, 'TURNS PER SECOND', 1482, 506, font(500, 13, MONO), COL.ink3, 'left', 2.6);
    if (u > 0) {
      const gp = P(TF, T.quake, T.quake + 0.25);
      text(ctx, scramble('GLITCH  +1.0%', gp, 90), 1482, 548, font(500, 15, MONO), COL.violet, 'left', 3);
    }
    ctx.globalAlpha = 1;
  }
}

// Gnomonic projection of the sky around the Crab, as seen from Earth.
function skyProj(ra, dec, ra0, dec0, f, cx, cy, out) {
  const a = (ra - ra0) * DEG, d = dec * DEG, d0 = dec0 * DEG;
  const cc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a);
  if (cc < 0.2) return false;
  out[0] = cx - (Math.cos(d) * Math.sin(a) / cc) * f;
  out[1] = cy - ((Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a)) / cc) * f;
  return true;
}
// The Milky Way along the galactic plane; it passes right by the Crab (the anticentre is in Taurus).
const BAND = (() => {
  const r = rng(77), out = [];
  const dG = 27.12825 * DEG, aG = 192.85948 * DEG, lN = 122.93192 * DEG;
  for (let i = 0; i < 2400; i++) {
    const l = (110 + 150 * r()) * DEG, b = gaussRand(r) * 5.5 * DEG;
    const dec = Math.asin(Math.sin(b) * Math.sin(dG) + Math.cos(b) * Math.cos(dG) * Math.cos(lN - l));
    const ra = aG + Math.atan2(Math.cos(b) * Math.sin(lN - l), Math.sin(b) * Math.cos(dG) - Math.cos(b) * Math.sin(dG) * Math.cos(lN - l));
    out.push((((ra / DEG) % 360) + 360) % 360, dec / DEG, 0.4 + 0.6 * r());
  }
  return out;
})();
// Where the view points, and how far it has zoomed in on the Crab for the title.
function skyView(t) {
  const u = t - T.sky;
  const zoom = Math.exp(lerp(0, 2.2, P(t, T.s6 - 0.08, T.s6 + 0.42, E.inCubic)));
  const ra0 = 85.5 - u * 2.4, dec0 = 15 + u * 0.6, f = 1180 * (1 + 0.05 * u);
  const c1 = [0, 0], cz = [0, 0];
  skyProj(CRAB.ra, CRAB.dec, ra0, dec0, f, 1180, 560, c1);
  skyProj(CRAB.ra, CRAB.dec, ra0, dec0, f * zoom, 1180, 560, cz);
  // zoom about the Crab: it stays put while the sky opens up around it
  return { ra0, dec0, f: f * zoom, cx: 1180 + c1[0] - cz[0], cy: 560 + c1[1] - cz[1], crab: c1, zoom };
}
function drawSky(ctx, t) {
  const a = P(t, T.sky - 0.01, T.sky + 0.05) * (1 - P(t, T.s6 + 0.08, T.s6 + 0.42));
  if (a <= 0) return;
  const u = t - T.sky;
  const v = skyView(t), { ra0, dec0, f, cx, cy } = v;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(5,9,24,${a})`);
  g.addColorStop(1, `rgba(16,24,52,${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < BAND.length; i += 3) {
    if (!skyProj(BAND[i], BAND[i + 1], ra0, dec0, f, cx, cy, OUT)) continue;
    const w = 0.0028 * BAND[i + 2] * a;
    SOFT.blob(OUT[0], OUT[1], 30, 0.7 * w, 0.78 * w, w);
    for (let j = 0; j < 3; j++) SPL.pt(OUT[0] + (hash(i * 3 + j) - 0.5) * 70, OUT[1] + (hash(i * 3 + j + 7) - 0.5) * 70, 0.06 * a, 0.065 * a, 0.08 * a);
  }
  SOFT.flush(ctx);
  for (const s of SKY.stars) {
    if (!skyProj(s.ra, s.dec, ra0, dec0, f, cx, cy, OUT)) continue;
    if (OUT[0] < -20 || OUT[0] > W + 20 || OUT[1] < -20 || OUT[1] > H + 20) continue;
    const flux = Math.pow(10, -0.4 * (s.mag - 1));
    const tw = 0.85 + 0.15 * Math.sin(t * 9 + s.ra * 13);
    const b = clamp(0.3 + 1.25 * Math.pow(flux, 0.5), 0.15, 3.2) * a * tw;
    SPL.blob(OUT[0], OUT[1], clamp(0.75 + 1.3 * Math.pow(flux, 0.3), 0.75, 5), s.c[0] * b, s.c[1] * b, s.c[2] * b);
  }
  SPL.flush(ctx);
  // constellation figures: Orion faint, Taurus drawn on
  const drawFig = (fig, alpha, p) => {
    ctx.strokeStyle = `rgba(160,185,240,${alpha})`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const arr of fig) {
      const segs = arr.length / 2 - 1;
      const upto = segs * p;
      for (let k = 0; k < segs && k < upto; k++) {
        const q = Math.min(1, upto - k);
        if (!skyProj(arr[k * 2], arr[k * 2 + 1], ra0, dec0, f, cx, cy, OUT)) continue;
        const x0 = OUT[0], y0 = OUT[1];
        if (!skyProj(arr[k * 2 + 2], arr[k * 2 + 3], ra0, dec0, f, cx, cy, OUT)) continue;
        ctx.moveTo(x0, y0);
        ctx.lineTo(lerp(x0, OUT[0], q), lerp(y0, OUT[1], q));
      }
    }
    ctx.stroke();
  };
  drawFig(SKY.orion, 0.24 * a, 1);
  drawFig(SKY.taurus, 0.8 * a, P(t, T.sky + 0.06, T.sky + 0.45, E.inOutCubic));
  const la = a * (1 - P(t, T.s6 - 0.1, T.s6 + 0.1));
  if (skyProj(69, 13, ra0, dec0, f, cx, cy, OUT)) {
    ctx.globalAlpha = la * P(t, T.sky + 0.2, T.sky + 0.5);
    text(ctx, 'TAURUS', OUT[0], OUT[1], font(500, 14, MONO), 'rgba(160,185,240,0.85)', 'center', 6);
    ctx.globalAlpha = 1;
  }
  if (skyProj(84, 3, ra0, dec0, f, cx, cy, OUT)) {
    ctx.globalAlpha = la * 0.6;
    text(ctx, 'ORION', OUT[0], OUT[1], font(500, 12, MONO), 'rgba(160,185,240,0.6)', 'center', 5);
    ctx.globalAlpha = 1;
  }
  // the Crab pulsar, blinking at the tip of the bull's horn
  if (skyProj(CRAB.ra, CRAB.dec, ra0, dec0, f, cx, cy, OUT)) {
    const x = OUT[0], y = OUT[1];
    const mp = P(t, T.sky + 0.2, T.sky + 0.4);
    const blink = 0.55 + 0.45 * Math.cos(TAU * u * 2.2);
    ctx.globalAlpha = a * mp;
    sprite(ctx, GLOW.amber, x, y, 44 + 16 * blink, 0.95);
    ctx.globalAlpha = la * mp;
    ctx.strokeStyle = COL.amber;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(x, y, 18 + 5 * spring(u - 0.2, 18, 0.4), 0, TAU);
    ctx.stroke();
    text(ctx, scramble('CRAB PULSAR', P(TF, T.sky + 0.25, T.sky + 0.55), 99), x + 32, y - 8, font(500, 15, MONO), COL.amber, 'left', 2.4);
    text(ctx, 'the tip of the bull’s horn', x + 32, y + 22, font(400, 26, SERIF, true), COL.ink2);
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ 06: title

// The site's brand mark: a star, its ring and two beams, in a 32-unit box.
function drawMark(ctx, x, y, s, spin, alpha, glow = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 32, s / 32);
  ctx.globalAlpha = alpha * 0.35;
  ctx.strokeStyle = COL.ice;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, 8.5, 0, TAU);
  ctx.stroke();
  ctx.rotate(spin);
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = COL.ice;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(13, -12); ctx.lineTo(15, -7); ctx.closePath();
  ctx.moveTo(0, 0); ctx.lineTo(-13, 12); ctx.lineTo(-15, 7); ctx.closePath();
  ctx.fill();
  ctx.rotate(-spin);
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(0, 0, 4.2, 0, TAU);
  ctx.fill();
  ctx.restore();
  if (glow > 0) sprite(ctx, GLOW.ice, x, y, s * 0.9, 0.45 * alpha * glow);
}
// The mark spins down to rest: the spin-up, played backwards. The turns left decay
// exponentially, so its ticks slow down geometrically, then it settles with a spring.
const MARK_T0 = T.s6 + 0.12, MARK_TAU = 0.3, MARK_TURNS = 6;
function markAngle(t) {
  const s = t - MARK_T0;
  if (s < 0) return -TAU * MARK_TURNS - (MARK_TURNS / MARK_TAU) * TAU * s;
  const left = MARK_TURNS * Math.exp(-s / MARK_TAU);
  return -TAU * left * (1 - spring(s - 0.9, 12, 0.45) * sstep(0.85, 1.4, s));
}
const MARK_TICKS = Array.from({ length: MARK_TURNS - 1 }, (_, k) => MARK_T0 + MARK_TAU * Math.log(MARK_TURNS / (MARK_TURNS - 1 - k)));
// The last heartbeat is one period before the first, so the loop keeps time.
const FINAL_TICK = T.end - (P0 - T.tick0);
const MARK_POS = { x: W / 2, y: 356 };
function drawTitle(ctx, t) {
  const a = P(t, T.s6 - 0.04, T.s6 + 0.2);
  if (a <= 0) return;
  const cx = W / 2;
  // a faint sky of stars behind, turning slowly
  const bgA = a * P(t, T.s6 + 0.1, T.s6 + 0.6);
  for (let i = 0; i < SHELL.length; i += 7 * 2) {
    const k = i / 7;
    const ang = hash(k * 3 + 1) * TAU + t * 0.03, rad = Math.pow(hash(k * 3 + 2), 0.5) * 1150;
    const x = cx + Math.cos(ang) * rad * 1.1, y = 540 + Math.sin(ang) * rad * 0.62;
    const b = SHELL[i + 6] * 0.3 * bgA;
    SPL.pt(x, y, SHELL[i + 3] * b, SHELL[i + 4] * b, SHELL[i + 5] * b);
  }
  SPL.flush(ctx);
  // the mark rises out of the Crab's blink and settles at the top
  const from = skyView(Math.min(t, T.s6 + 0.42)).crab;
  const mv = P(t, T.s6, T.s6 + 0.55, E.outCubic);
  const mx = lerp(from[0], MARK_POS.x, mv), my = lerp(from[1], MARK_POS.y, mv);
  const size = lerp(70, 300, spring(t - T.s6 - 0.02, 11, 0.55));
  // a ring goes out with every tick
  for (const tk of [...MARK_TICKS, FINAL_TICK]) {
    const age = t - tk;
    if (age < 0 || age > 1.3) continue;
    const q = E.outCubic(age / 1.3);
    ctx.strokeStyle = rgba(COL.ice, 0.45 * (1 - q) * a);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, size * 0.27 + 620 * q, 0, TAU);
    ctx.stroke();
  }
  const jit = 10;
  for (let j = 0; j < jit; j++) {
    const tj = t + ((j + 0.5) / jit - 0.5) * SL;
    drawMark(ctx, mx, my, size, markAngle(tj), a / jit, 0);
  }
  sprite(ctx, GLOW.ice, mx, my, size, 0.5 * a);
  // the spin-down ticks glint softly (they come fast); the last heartbeat flashes
  let hit = 0;
  for (const tk of [...MARK_TICKS, FINAL_TICK]) if (t >= tk) hit = Math.max(hit, Math.exp(-(t - tk) / 0.09) * (tk === FINAL_TICK ? 1 : 0.45));
  sprite(ctx, GLOW.white, mx, my, size * 0.3 + 160 * hit, 0.25 * a + 0.75 * hit);
  // COSMIC CLOCKS tunes in letter by letter
  const title = 'COSMIC CLOCKS';
  const tf = font(500, 96, MONO, false, 'semi-expanded');
  const sp = 0.3 * 96;
  const tw = measure(ctx, title, tf, sp);
  let x = cx - tw / 2;
  for (let i = 0; i < title.length; i++) {
    const c = title[i];
    const lockT = LETTER0 + i * 0.045;
    const w = measure(ctx, c, tf, 0) + sp;
    if (c !== ' ' && t >= lockT - 0.3) {
      const locked = TF >= lockT;
      const ch = locked ? c : GLYPHS[Math.floor(hash(i * 71 + Math.floor(TF * 40)) * 26)];
      const p = P(t, lockT - 0.3, lockT + 0.1, E.outCubic);
      text(ctx, ch, x, 604 + (1 - p) * 24, tf, locked ? COL.ink : rgba(COL.ice, 0.6));
    }
    x += w;
  }
  const tp = P(t, T.s6 + 1.0, T.s6 + 1.5, E.outCubic);
  if (tp > 0) {
    ctx.globalAlpha = tp;
    text(ctx, 'An interactive listening room for pulsars.', cx, 684 + (1 - tp) * 18, font(400, 48, SERIF, true), COL.ink2, 'center');
    ctx.globalAlpha = 1;
  }
  // chips
  const chips = ['12 REAL PULSARS', 'TRUE SPIN RATES', 'LIVE SOUND', 'RUNS IN YOUR BROWSER'];
  const cf = font(500, 15, MONO), csp = 2.6;
  const cw = chips.map((c) => measure(ctx, c, cf, csp) + 40);
  const total = cw.reduce((s, w) => s + w, 0) + 14 * (chips.length - 1);
  let chx = cx - total / 2;
  chips.forEach((c, i) => {
    const p = P(t, T.s6 + 1.2 + i * 0.07, T.s6 + 1.55 + i * 0.07, E.outCubic);
    if (p > 0) {
      ctx.globalAlpha = p;
      ctx.strokeStyle = COL.line2;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(chx, 744 + (1 - p) * 14, cw[i], 42, 21);
      ctx.stroke();
      text(ctx, c, chx + 20, 770 + (1 - p) * 14, cf, COL.ink2, 'left', csp);
      ctx.globalAlpha = 1;
    }
    chx += cw[i] + 14;
  });
  // the address, typed
  const url = 'mateuszkrw-coder.github.io/cosmic-clocks';
  const up = P(TF, URL_T[0], URL_T[1]);
  if (up > 0) {
    const n = Math.round(url.length * up);
    const uf = font(500, 24, MONO);
    const uw = measure(ctx, url, uf, 1);
    text(ctx, url.slice(0, n), cx - uw / 2, 866, uf, COL.amber, 'left', 1);
    if (up < 1 || Math.floor(TF * 3) % 2 === 0) {
      const cxp = cx - uw / 2 + measure(ctx, url.slice(0, n), uf, 1) + 6;
      ctx.fillStyle = COL.amber;
      ctx.fillRect(cxp, 844, 12, 28);
    }
  }
}
const LETTER0 = T.s6 + 0.5, URL_T = [T.s6 + 1.45, T.s6 + 1.95];

// ------------------------------------------------------------------ HUD

function drawHUD(ctx, t) {
  const a = P(t, 0.15, 0.6) * (1 - P(t, T.end - 0.35, T.end - 0.05));
  if (a <= 0) return;
  const m = 44, arm = 22;
  ctx.globalAlpha = a;
  ctx.strokeStyle = 'rgba(160,185,240,0.32)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    ctx.moveTo(x, y + sy * arm); ctx.lineTo(x, y); ctx.lineTo(x + sx * arm, y);
  }
  ctx.stroke();
  // brand
  drawMark(ctx, m + 44, m + 30, 34, 0, 0.9, 0.5);
  text(ctx, 'COSMIC CLOCKS', m + 72, m + 36, font(500, 14, MONO, false, 'semi-expanded'), COL.ink2, 'left', 4.2);
  // chapter
  let ch = CHAPTERS[0];
  for (const c of CHAPTERS) if (t >= c[0]) ch = c;
  const cp = P(TF, ch[0], ch[0] + 0.4);
  text(ctx, `${ch[1]} / 06`, W - m - 36, m + 36, font(500, 14, MONO), COL.amber, 'right', 3);
  text(ctx, scramble(ch[2], cp, Number(ch[1])), W - m - 36 - 118, m + 36, font(500, 14, MONO), COL.ink2, 'right', 3);
  // the site's own counter: turns since you tuned in, still counting at 716 a second
  if (TF >= T.tick0) {
    const n = Math.floor(spinPhase(TF)) + 1;
    text(ctx, 'SINCE YOU TUNED IN', m + 36, H - m - 12, font(500, 13, MONO), COL.ink3, 'left', 2.6);
    text(ctx, `${fmt(n)} TURNS`, m + 36 + 262, H - m - 12, font(500, 13, MONO), COL.ice, 'left', 2.6);
  }
  text(ctx, 'DRAWN IN CODE FROM THE SITE’S OWN DATA', W - m - 36, H - m - 12, font(500, 13, MONO), COL.ink3, 'right', 2.6);
  ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------ frame

function drawScene(ctx, t, frameTime = t, slice = 0, k = 0) {
  TF = frameTime;
  SL = slice;
  SK = k;
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  drawMain(ctx, t);
  drawGalaxy(ctx, t);
  drawTrace(ctx, t);
  drawDial(ctx, t);
  drawReadout(ctx, t);
  drawInstruments(ctx, t);
  drawSupernova(ctx, t);
  drawGlitch(ctx, t);
  drawSky(ctx, t);
  drawTitle(ctx, t);
  for (const h of HEADLINES) drawHeadline(ctx, h, t);
  drawHUD(ctx, t);

  // In from black, out to black: the loop point.
  const black = 1 - P(t, 0, 0.28) + P(t, T.end - 0.3, T.end);
  if (black > 0) {
    ctx.fillStyle = `rgba(0,0,0,${clamp(black)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// Lens settings for the post-processing pass, over time.
function effects(t) {
  const hb = ticked(t, HEART, 0.07);
  const slow = 1 - sstep(0.2, 0.5, Math.log10(spinRate(t)));
  const sn = t >= T.s5 ? Math.exp(-(t - T.s5) / 0.14) : 0;
  const gq = t >= T.quake ? Math.exp(-(t - T.quake) / 0.1) : 0;
  const warp = Math.sin(Math.PI * P(t, T.s3, T.s3 + 0.55));
  const fin = t >= FINAL_TICK ? Math.exp(-(t - FINAL_TICK) / 0.1) : 0;
  return {
    bloom: 0.36 + 0.3 * hb * slow + 0.5 * sn + 0.3 * gq, threshold: 0.7, knee: 0.4, radius: 1.0,
    streak: 0.5 + 0.8 * hb * slow + 0.8 * sn, streakThreshold: 0.72,
    aberration: 2 + 7 * hb * slow + 10 * warp + 18 * sn + 22 * gq + 6 * fin,
    vignette: 0.6, grain: 0, exposure: 1.0 + 0.45 * hb * slow + 0.6 * sn + 0.3 * gq + 0.25 * fin, flash: 0,
    lift: 1, seed: 1,
  };
}

// When things happen, for the sound track (make_audio.py).
function cues() {
  const phi = [];
  for (let t = 0; t <= DURATION + 1e-9; t += 0.001) phi.push(Number(spinPhase(t).toFixed(6)));
  return {
    T, P0, F_END,
    heart: HEART,
    phi: { dt: 0.001, values: phi },
    stations: STATIONS.filter((s) => s.t > T.s2).map((s) => ({ t: s.t, f: s.p.f, name: s.p.short })),
    galaxyPops: PULSARS.slice().sort((p, q) => p.f - q.f).map((p, k) => ({ t: POP0 + k * POP_DT, f: p.f })),
    arcs: Array.from({ length: PULSARS.length - 1 }, (_, i) => ARC0 + i * ARC_DT),
    stack: ARRIVE,
    fold: [FOLD.t0, FOLD.bend[1]],
    clockTicks: Array.from({ length: 4 }, (_, k) => HAND0 + k * CP1919.P).filter((x) => x < T.s5),
    supernova: T.s5, glitch: T.glitch, quake: T.quake, sky: T.sky,
    velaTicks: (() => { const out = []; for (let k = Math.ceil(velaPhase(T.glitch)); velaPhase(T.sky) >= k; k++) { let a = T.glitch, b = T.sky; for (let j = 0; j < 40; j++) { const m = (a + b) / 2; if (velaPhase(m) < k) a = m; else b = m; } out.push(b); } return out; })(),
    crab: T.sky + 0.25,
    title: T.s6, markTicks: MARK_TICKS,
    letters: [...'COSMIC CLOCKS'].map((c, i) => (c === ' ' ? null : LETTER0 + i * 0.045)).filter((x) => x !== null),
    url: URL_T,
    final: FINAL_TICK,
  };
}

window.Showreel = { W, H, DURATION, drawScene, effects, cues };
})();

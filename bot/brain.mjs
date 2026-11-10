// Kurswerk Auto-Trader v2 – erkennt mehrere Kaufmuster, bewertet sie mit einem lernenden Modell
// und lernt laufend aus echten Trades, aus „Schatten-Trades“ (beobachtete, aber nicht gekaufte Signale)
// und einmalig aus einem Jahr Kursgeschichte.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const KW = require('../engine.js');

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const fin = (x, d = 0) => (Number.isFinite(x) ? x : d);
const r2 = (x) => Math.round(x * 100) / 100;

/* ---------- Kaufmuster ---------- */
export const SETUPS = {
  mom:   { n: 'Momentum',      kSL: 1.3, mult: 2,   maxH: 72,  txt: 'Kauft Werte, die gerade kräftig steigen.' },
  brk:   { n: 'Ausbruch',      kSL: 1.5, mult: 2,   maxH: 120, txt: 'Kauft, wenn ein Wert über sein 20-Tage-Hoch steigt.' },
  pb:    { n: 'Rücksetzer',    kSL: 1.2, mult: 2,   maxH: 96,  txt: 'Kauft kurze Dellen in intakten Aufwärtstrends.' },
  trend: { n: 'Trend',         kSL: 2.0, mult: 0,   maxH: 480, txt: 'Hält Werte mit stabilem Aufwärtstrend, Gewinne laufen mit nachgezogenem Stopp.' },
  reb:   { n: 'Rebound',       kSL: 1.3, mult: 1.5, maxH: 48,  txt: 'Kauft stark gefallene Werte, sobald sie nach oben drehen.' },
  rs:    { n: 'Marktführer',   kSL: 1.8, mult: 3,   maxH: 240, txt: 'Kauft Werte, die seit Wochen klar besser laufen als ihr Markt.' }
};
const VARIANTS = [1.5, 2, 3, 0]; // Gewinnziel in R; 0 = kein festes Ziel, nachgezogener Stopp
export const FEATS = ['dayZ', 'stepZ', 'rsiD', 'emaDist', 'emaSlope', 'highDist', 'ret20Z', 'breadth', 'bench', 'relS', 'volLvl', 'rsiH'];
export const FEAT_LABELS = {
  dayZ: 'Tagesbewegung', stepZ: 'Bewegung der letzten Stunde', rsiD: 'Überkauft/überverkauft (Tage)', emaDist: 'Abstand zum 20-Tage-Schnitt',
  emaSlope: 'Steigung des Trends', highDist: 'Nähe zum 20-Tage-Hoch', ret20Z: 'Entwicklung über 20 Tage', breadth: 'Marktbreite (wie viele steigen)',
  bench: 'Richtung des Gesamtmarkts', relS: 'Stärke gegenüber dem Markt', volLvl: 'Schwankungsniveau', rsiH: 'Überkauft/überverkauft (Stunden)'
};
const MK = { us: 'US-Aktien', de: 'deutschen Aktien', cr: 'Krypto' };
const REG = { up: 'in starkem Markt', flat: 'in ruhigem Markt', down: 'in schwachem Markt' };
const BASE_VOL = { de: 1.6, us: 2.0, cr: 3.5 };
const LEVELS = [
  { n: 'Vorsichtig', rpt: 1.0, maxPct: 20, maxPos: 6, kelly: 0.25, minEV: 0.6, crMax: 20, dll: 2 },
  { n: 'Ausgewogen', rpt: 1.75, maxPct: 28, maxPos: 8, kelly: 0.4, minEV: 0.4, crMax: 35, dll: 3 },
  { n: 'Aggressiv', rpt: 2.5, maxPct: 35, maxPos: 10, kelly: 0.6, minEV: 0.25, crMax: 50, dll: 4 }
];
export const RISK_MAX = { niedrig: 0, mittel: 1, hoch: 2 };

/* ---------- Indikatoren ---------- */
function emaArr(a, n) { if (!a.length) return []; const k = 2 / (n + 1); const out = [a[0]]; for (let i = 1; i < a.length; i++) out.push(a[i] * k + out[i - 1] * (1 - k)); return out; }
function rsi(a, n = 14) {
  if (a.length < n + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = a[i] - a[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < a.length; i++) { const d = a[i] - a[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function dayVolOf(closes, m) {
  const base = BASE_VOL[m] || 2;
  const n = Math.min(21, closes.length);
  if (n < 8) return base;
  const r = [];
  for (let i = closes.length - n + 1; i < closes.length; i++) if (closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  const mean = r.reduce((x, y) => x + y, 0) / r.length;
  const sd = Math.sqrt(r.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, r.length - 1)) * 100;
  return clamp(sd, base * 0.4, base * 4);
}

/* Merkmale aus Tages-Schlusskursen (closes endet mit dem aktuellen Kurs), Stundenpunkten h und Marktumfeld */
export function features(closes, ch, h, m, ctx) {
  const p = closes[closes.length - 1];
  const dv = dayVolOf(closes, m);
  const f = {};
  f.dayZ = ch / dv;
  let stepZ = 0, rsiH = 0;
  if (h && h.length >= 2) {
    const a = h[h.length - 2][1], b = h[h.length - 1][1];
    stepZ = a > 0 ? (b / a - 1) * 100 / (dv / Math.sqrt(7)) : 0;
    if (h.length >= 9) { const rv = rsi(h.map((x) => x[1]), 8); rsiH = rv == null ? 0 : (rv - 50) / 50; }
  }
  f.stepZ = stepZ;
  const rD = rsi(closes, 14); f.rsiD = rD == null ? 0 : (rD - 50) / 50;
  const e20 = emaArr(closes, 20), e50 = emaArr(closes, 50);
  const E20 = e20[e20.length - 1], E20p = e20[Math.max(0, e20.length - 6)];
  f.emaDist = closes.length >= 10 ? (p / E20 - 1) * 100 / dv : 0;
  f.emaSlope = closes.length >= 12 ? (E20 / E20p - 1) * 100 / dv : 0;
  const hi = Math.max(...closes.slice(-21, -1).concat([0]));
  f.highDist = closes.length >= 21 && hi > 0 ? (p / hi - 1) * 100 / dv : -1;
  const c20 = closes[closes.length - 21];
  f.ret20Z = closes.length >= 21 && c20 > 0 ? (p / c20 - 1) * 100 / (dv * Math.sqrt(20)) : 0;
  f.breadth = fin(ctx.breadth[m]);
  f.bench = fin(ctx.bench[m]);
  f.relS = (ch - fin(ctx.avg[m])) / dv;
  f.volLvl = dv / (BASE_VOL[m] || 2) - 1;
  f.rsiH = rsiH;
  for (const k of FEATS) f[k] = r2(clamp(fin(f[k]), -3, 3));
  const aux = { dv, p, e50: e50[e50.length - 1], n: closes.length, hasH: !!(h && h.length >= 2) };
  return { f, aux };
}

/* Welche Kaufmuster liegen gerade vor? live=false: nur Tagesdaten (Vortraining) */
export function detect(f, aux, ch, m, live) {
  const out = [];
  const thr = m === 'cr' ? 3 : m === 'de' ? 1.5 : 2;
  const stepOk = !live || !aux.hasH || f.stepZ >= -0.3;
  if (f.dayZ >= 1 && ch >= thr && ch <= (m === 'cr' ? 30 : 18) && stepOk) out.push('mom');
  if (aux.n >= 21 && f.highDist >= -0.05 && ch > 0 && f.emaSlope > 0) out.push('brk');
  if (aux.n >= 25 && f.emaSlope > 0.3 && aux.p > aux.e50 && (f.dayZ <= -0.6 || (live && f.rsiH < -0.3)) && (!live || !aux.hasH || f.stepZ > 0)) out.push('pb');
  if (aux.n >= 25 && f.emaDist > 0 && f.emaSlope > 0.2 && f.ret20Z > 0.5 && f.dayZ > -0.5) out.push('trend');
  if ((f.rsiD < -0.4 || f.dayZ <= -2) && (live ? (aux.hasH ? f.stepZ > 0.2 : f.dayZ > -2.5 && f.rsiD < -0.5) : f.dayZ > 0)) out.push('reb');
  if (aux.n >= 25 && f.ret20Z >= 1.2 && f.relS > 0.3 && f.dayZ > 0) out.push('rs');
  return out;
}
export function riskPct(setup, dv, m) { return clamp(SETUPS[setup].kSL * dv, 2, m === 'cr' ? 15 : 12); }

/* ---------- Lernendes Modell ---------- */
export function newBrain() {
  const w = {}; FEATS.forEach((k) => { w[k] = 0; });
  Object.keys(SETUPS).forEach((s) => { w['s_' + s] = -0.1; }); ['us', 'de', 'cr'].forEach((m) => { w['m_' + m] = 0; });
  return { v: 2, w, n: 0, buckets: {}, exits: {}, shadow: [], acc: { n: 0, ok: 0 }, pre: { done: false, n: 0 }, counts: { pre: 0, shadow: 0, real: 0 }, status: {}, backfill: {} };
}
const sig = (x) => 1 / (1 + Math.exp(-x));
function logit(brain, f, setup, m) {
  let z = (brain.w['s_' + setup] || 0) + (brain.w['m_' + m] || 0);
  for (const k of FEATS) z += (brain.w[k] || 0) * (f[k] || 0);
  return z;
}
export const regimeOf = (breadth) => (breadth > 0.25 ? 'up' : breadth < -0.25 ? 'down' : 'flat');
function bucketKey(setup, m, reg) { return setup + '|' + m + '|' + reg; }
export function exitMult(brain, setup) {
  const e = brain.exits[setup];
  let best = SETUPS[setup].mult, bestR = -Infinity;
  if (e) for (const v of VARIANTS) { const s = e[v]; if (s && s.n >= 25) { const avg = s.sum / s.n; if (avg > bestR) { bestR = avg; best = v; } } }
  return best;
}
/* Erwartung in R (Vielfache des Risikos) und Gewinnwahrscheinlichkeit */
export function predict(brain, f, setup, m) {
  const reg = regimeOf(f.breadth);
  const pLR = sig(logit(brain, f, setup, m));
  const b = brain.buckets[bucketKey(setup, m, reg)];
  const prior = 8, p0 = 0.45, r0 = 0.05;
  const pB = b ? (b.w + prior * p0) / (b.n + prior) : p0;
  const rB = b ? (b.sumR + prior * r0) / (b.n + prior) : r0;
  const p = clamp(0.55 * pLR + 0.45 * pB, 0.02, 0.98);
  const mult = exitMult(brain, setup);
  const payoff = mult > 0 ? mult : 2.2;
  const evModel = p * payoff - (1 - p);
  const conf = b ? Math.min(1, b.n / 40) : 0;
  const evR = (1 - conf) * evModel * 0.6 + conf * rB; // vorsichtig, solange wenig Erfahrung vorliegt
  return { p, evR, mult, reg, n: b ? b.n : 0 };
}
function learn(brain, f, setup, m, reg, R, weight, kind) {
  const y = R > 0 ? 1 : 0;
  const p = sig(logit(brain, f, setup, m));
  const lr = 0.03 * weight, l2 = 0.0005;
  const g = y - p;
  for (const k of FEATS) brain.w[k] = r2c(brain.w[k] + lr * (g * (f[k] || 0) - l2 * brain.w[k]));
  brain.w['s_' + setup] = r2c((brain.w['s_' + setup] || 0) + lr * g);
  brain.w['m_' + m] = r2c((brain.w['m_' + m] || 0) + lr * g * 0.5);
  const key = bucketKey(setup, m, reg);
  const b = brain.buckets[key] || (brain.buckets[key] = { n: 0, w: 0, sumR: 0 });
  b.n = r2(b.n + weight); b.w = r2(b.w + weight * y); b.sumR = r2(b.sumR + weight * clamp(R, -2, 5));
  brain.n++;
  brain.counts[kind] = (brain.counts[kind] || 0) + 1;
}
function r2c(x) { return Math.round(clamp(x, -6, 6) * 10000) / 10000; }
function recordExit(brain, setup, outcomes, weight) {
  const e = brain.exits[setup] || (brain.exits[setup] = {});
  VARIANTS.forEach((v, i) => { const s = e[v] || (e[v] = { n: 0, sum: 0 }); s.n = r2(s.n + weight); s.sum = r2(s.sum + weight * outcomes[i]); });
}

/* Schatten-Trade: wie wäre es ausgegangen? Für jede Ziel-Variante getrennt */
function stepShadow(sh, price, t) {
  const g = (price / sh.p0 - 1) * 100 / sh.R; // Gewinn in R
  sh.pk = Math.max(sh.pk, g);
  const timeout = t - sh.t0 >= sh.maxH * HOUR;
  VARIANTS.forEach((v, i) => {
    if (sh.o[i] != null) return;
    if (g <= -1) { sh.o[i] = -1; return; }
    if (v > 0 && g >= v) { sh.o[i] = v; return; }
    if (v === 0 && sh.pk >= 1 && g <= sh.pk - 1) { sh.o[i] = r2(Math.max(0, sh.pk - 1)); return; }
    if (timeout) sh.o[i] = r2(g);
  });
  return sh.o.every((x) => x != null);
}

/* ---------- Vortraining mit Tageshistorie ---------- */
export function pretrain(brain, series, now) {
  // series: [{id, m, d: [[dayNum, close], ...]}]
  const byDay = {}; // dayNum -> m -> [returns]
  for (const s of series) for (let i = 1; i < s.d.length; i++) {
    const r = (s.d[i][1] / s.d[i - 1][1] - 1) * 100; if (!Number.isFinite(r)) continue;
    const dd = byDay[s.d[i][0]] || (byDay[s.d[i][0]] = {}); (dd[s.m] || (dd[s.m] = [])).push(r);
  }
  const ctxOf = (day, m) => {
    const arr = (byDay[day] && byDay[day][m]) || [];
    if (arr.length < 5) return { breadth: { [m]: 0 }, bench: { [m]: 0 }, avg: { [m]: 0 } };
    const up = arr.filter((x) => x > 0.05).length, dn = arr.filter((x) => x < -0.05).length;
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    return { breadth: { [m]: (up - dn) / arr.length }, bench: { [m]: clamp(avg / (BASE_VOL[m] * 0.6), -3, 3) }, avg: { [m]: avg } };
  };
  const samples = [];
  for (const s of series) {
    const closes = s.d.map((x) => x[1]);
    for (let t = 50; t < closes.length - 2; t += 1) {
      const ch = (closes[t] / closes[t - 1] - 1) * 100;
      const ctx = ctxOf(s.d[t][0], s.m);
      const { f, aux } = features(closes.slice(0, t + 1), ch, null, s.m, ctx);
      const sets = detect(f, aux, ch, s.m, false);
      for (const setup of sets) {
        const R = riskPct(setup, aux.dv, s.m);
        const sh = { p0: closes[t], R, pk: 0, t0: 0, maxH: SETUPS[setup].maxH, o: VARIANTS.map(() => null) };
        const daysMax = Math.max(2, Math.min(20, Math.round(SETUPS[setup].maxH / 24)));
        for (let k = 1; k <= daysMax && t + k < closes.length; k++) { if (stepShadow(sh, closes[t + k], k === daysMax ? sh.maxH * HOUR : 0)) break; }
        if (sh.o.some((x) => x == null)) continue;
        samples.push({ f, setup, m: s.m, reg: regimeOf(f.breadth), o: sh.o });
      }
    }
  }
  // gleichmäßig ausdünnen
  let use = samples;
  if (samples.length > 9000) { const step = samples.length / 9000; use = []; for (let x = 0; x < samples.length; x += step) use.push(samples[Math.floor(x)]); }
  for (let ep = 0; ep < 3; ep++) for (const s of use) {
    const vi = VARIANTS.indexOf(SETUPS[s.setup].mult);
    const R = s.o[vi < 0 ? 1 : vi];
    if (ep === 0) { learn(brain, s.f, s.setup, s.m, s.reg, R, 0.35, 'pre'); recordExit(brain, s.setup, s.o, 0.35); }
    else { const p = sig(logit(brain, s.f, s.setup, s.m)); const g = (R > 0 ? 1 : 0) - p; for (const k of FEATS) brain.w[k] = r2c(brain.w[k] + 0.01 * g * (s.f[k] || 0)); brain.w['s_' + s.setup] = r2c(brain.w['s_' + s.setup] + 0.01 * g); }
  }
  brain.pre = { done: true, n: use.length, t: now, days: Object.keys(byDay).length };
  return use.length;
}

/* ---------- Text-Hilfen ---------- */
const fmtEur = (x) => (x < 0 ? '−' : '') + Math.abs(x).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' €';
const fmtPct = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d).replace('.', ',') + ' %';
const fmtQty = (q, m) => (m === 'cr' ? String(+q.toFixed(q < 1 ? 6 : 4)).replace('.', ',') : String(q));
function why(setup, f, ch, m, pr) {
  const parts = {
    mom: fmtPct(ch) + (m === 'cr' ? ' in 24 h' : ' heute') + (f.stepZ > 0.3 ? ', steigt weiter' : ''),
    brk: 'neues 20-Tage-Hoch' + (f.dayZ > 1 ? ' mit kräftigem Plus' : ''),
    pb: 'Delle im Aufwärtstrend (' + fmtPct(ch) + ')',
    trend: 'stabiler Aufwärtstrend über dem 20-Tage-Schnitt',
    reb: 'stark gefallen, dreht jetzt nach oben',
    rs: 'läuft seit Wochen besser als der Markt'
  };
  return SETUPS[setup].n + ': ' + parts[setup] + ' · Trefferchance ' + Math.round(pr.p * 100) + ' %';
}

/* ---------- Eine Runde ---------- */
export function defaultSettings() { return { enabled: true, risk: 'hoch', invest: 1, capital: 100000, markets: { us: true, de: true, cr: true }, feePct: 0.1, resetAt: 0 }; }
function newBot(now, capital) {
  return { v: 2, createdAt: now, startCash: capital, cash: capital, pos: {}, trades: [], closed: [], w: {}, lvl: 2,
    eq: [[Math.round(now / MIN), capital]], peak: capital, maxDD: 0, log: [{ t: now, k: 'info', x: 'Auto-Trader gestartet mit ' + fmtEur(capital) + ' Startkapital.' }],
    cd: {}, runs: 0, lastRun: 0, stats: { n: 0, wins: 0, realized: 0, fees: 0, best: null, worst: null } };
}
function upgradePos(p) {
  if (p.setup) return p;
  p.setup = p.st;
  p.R = r2(Math.max(1, (1 - p.sl / p.p0) * 100));
  p.mult = p.tp ? r2((p.tp / p.p0 - 1) * 100 / p.R) : 0;
  p.maxH = SETUPS[p.setup] ? SETUPS[p.setup].maxH : 96;
  return p;
}

export function runRound({ bot: botIn, brain: brainIn, settings: setIn, market, daily, now }) {
  const settings = Object.assign(defaultSettings(), setIn || {});
  settings.markets = Object.assign({ us: true, de: true, cr: true }, settings.markets || {});
  const invest = clamp(+settings.invest || 1, 0.25, 1);
  const capital = clamp(+settings.capital || 100000, 1000, 100000000);
  let bot = botIn && botIn.cash != null ? JSON.parse(JSON.stringify(botIn)) : newBot(now, capital);
  const brain = brainIn && brainIn.v === 2 ? brainIn : newBrain();
  const events = [];
  const log = (k, x) => { bot.log.push({ t: now, k, x }); events.push(x); };
  if (settings.resetAt && settings.resetAt > bot.createdAt) {
    bot = newBot(now, capital);
    bot.log[0].x = 'Auto-Trader neu gestartet mit ' + fmtEur(capital) + ' – das Gelernte bleibt erhalten.';
  }
  if (!bot.v || bot.v < 2) { Object.values(bot.pos).forEach(upgradePos); bot.v = 2; log('learn', 'Neues Gehirn aktiv: sechs Kaufmuster, lernendes Modell, Schatten-Trades und volle Kapitalnutzung.'); }
  if (!bot.cd) bot.cd = {};
  const fx = market.fx, feePct = settings.feePct == null ? 0.1 : settings.feePct;
  const maxLvl = RISK_MAX[settings.risk] == null ? 2 : RISK_MAX[settings.risk];
  if (bot.lvl > maxLvl) bot.lvl = maxLvl;

  /* Marktumfeld */
  const ctx = { breadth: {}, bench: {}, avg: {} };
  for (const m of ['us', 'de', 'cr']) {
    const qs = Object.values(market.q).filter((q) => q.m === m && !q.nc && KW.isFresh(q, market, now));
    if (qs.length < 5) { ctx.breadth[m] = 0; ctx.bench[m] = 0; ctx.avg[m] = 0; continue; }
    const up = qs.filter((q) => q.ch > 0.05).length, dn = qs.filter((q) => q.ch < -0.05).length;
    ctx.breadth[m] = (up - dn) / qs.length;
    ctx.avg[m] = qs.reduce((a, q) => a + q.ch, 0) / qs.length;
  }
  const mac = market.macro || {};
  ctx.bench.us = mac.SPX ? clamp(mac.SPX.ch / 1.1, -3, 3) : clamp(ctx.avg.us / 1.2, -3, 3);
  ctx.bench.de = mac.DAX ? clamp(mac.DAX.ch / 1.2, -3, 3) : clamp(ctx.avg.de / 1.2, -3, 3);
  ctx.bench.cr = market.q['BTC.X'] ? clamp(market.q['BTC.X'].ch / 3, -3, 3) : 0;

  const seriesOf = (id, q) => {
    const sh = KW.dailyShard(id, q);
    const d = daily[sh] && daily[sh].d && daily[sh].d[id];
    const closes = d ? d.map((x) => x[1]) : [];
    if (!closes.length || closes[closes.length - 1] !== q.p) closes.push(q.p);
    return closes;
  };
  const feat = {};
  const featOf = (id) => {
    if (feat[id]) return feat[id];
    const q = market.q[id];
    return (feat[id] = features(seriesOf(id, q), q.ch || 0, q.h, q.m, ctx));
  };

  /* 1) Schatten-Trades auswerten → lernen */
  const keep = [];
  for (const sh of brain.shadow) {
    const q = market.q[sh.id];
    if (!q) continue;
    if (KW.canTrade(q, market, now) || now - sh.t0 >= sh.maxH * HOUR) {
      if (stepShadow(sh, q.p, now)) {
        const vi = VARIANTS.indexOf(exitMult(brain, sh.s));
        const R = sh.o[vi < 0 ? 1 : vi];
        const pr = sig(logit(brain, sh.f, sh.s, sh.m));
        brain.acc.n++; if ((pr > 0.5) === (R > 0)) brain.acc.ok++;
        learn(brain, sh.f, sh.s, sh.m, sh.reg, R, 0.7, 'shadow');
        recordExit(brain, sh.s, sh.o, 0.7);
        continue;
      }
    }
    keep.push(sh);
  }
  brain.shadow = keep;

  /* 2) Positionen prüfen und Ausstiege */
  Object.values(bot.pos).forEach(upgradePos);
  const sell = (id, why) => {
    const p = bot.pos[id], q = market.q[id];
    const valEur = p.q * q.p * KW.fxToEur(p.c, fx), f = KW.fee(valEur, feePct);
    const pl = valEur - f - p.cost, pp = pl / p.cost * 100, R = ((q.p / p.p0 - 1) * 100) / p.R;
    bot.cash += valEur - f;
    bot.trades.push({ i: id, n: q.s, s: 'V', q: p.q, p: q.p, c: p.c, v: r2(valEur), f, t: now, st: p.setup, r: why, pl: r2(pl), pp: r2(pp) });
    bot.closed.push({ st: p.setup, pp: r2(pp), pl: r2(pl), t: now, i: id, R: r2(R) });
    if (bot.closed.length > 300) bot.closed.splice(0, bot.closed.length - 300);
    const s = bot.stats; s.n++; if (pl > 0) s.wins++; s.realized = r2(s.realized + pl); s.fees = r2(s.fees + f);
    if (!s.best || pl > s.best.pl) s.best = { n: q.n, pl: r2(pl), pp: r2(pp), t: now };
    if (!s.worst || pl < s.worst.pl) s.worst = { n: q.n, pl: r2(pl), pp: r2(pp), t: now };
    if (p.f) learn(brain, p.f, p.setup, q.m, p.reg || regimeOf(p.f.breadth), R, 2, 'real');
    bot.cd[id] = now + (pl < 0 ? 12 * HOUR : 3 * HOUR);
    delete bot.pos[id];
    log(pl >= 0 ? 'win' : 'loss', 'Verkauft: ' + fmtQty(p.q, q.m) + ' × ' + q.n + (pl >= 0 ? ' mit Gewinn ' : ' mit Verlust ') + fmtEur(pl) + ' (' + fmtPct(pp) + ') – ' + why + '.');
  };
  const totalRet = (KW.equityOf(bot, market) / bot.startCash - 1) * 100;
  if (settings.enabled) {
    for (const id of Object.keys(bot.pos)) {
      const p = bot.pos[id], q = market.q[id];
      if (!q) continue;
      p.lp = q.p;
      if (!KW.canTrade(q, market, now)) continue;
      if (q.p > (p.pk || 0)) p.pk = q.p;
      const g = (q.p / p.p0 - 1) * 100 / p.R, pkR = (p.pk / p.p0 - 1) * 100 / p.R;
      const trailR = totalRet > 5 ? 0.8 : 1; // Gewinne sichern, wenn das Depot klar im Plus ist
      if (g <= -1) { sell(id, 'Stop-Loss ausgelöst (Verlust begrenzt)'); continue; }
      if (p.mult > 0 && g >= p.mult) { sell(id, 'Gewinnziel erreicht'); continue; }
      if (pkR >= 1 && g <= Math.max(0.1, pkR - trailR)) { sell(id, pkR - trailR > 0.1 ? 'Gewinne gesichert (Kurs fiel vom Hoch zurück)' : 'Ohne Verlust ausgestiegen (Stopp auf Einstand nachgezogen)'); continue; }
      if (now - p.t0 >= p.maxH * HOUR) { sell(id, g > 0 ? 'Haltedauer erreicht, Gewinn mitgenommen' : 'Idee hat sich nicht entwickelt (Zeitlimit)'); continue; }
      // Stopps für die Anzeige aktuell halten
      const stopR = pkR >= 1 ? Math.max(0.1, pkR - trailR) : -1;
      p.sl = +(p.p0 * (1 + stopR * p.R / 100)).toPrecision(6);
      p.tr = p.R;
    }
  }

  /* 3) Risikostufe an Ergebnis anpassen */
  const eqNow = KW.equityOf(bot, market);
  if (eqNow > bot.peak) bot.peak = eqNow;
  const dd = (1 - eqNow / bot.peak) * 100;
  if (dd > bot.maxDD) bot.maxDD = r2(dd);
  const pf = (arr) => { let w = 0, l = 0; arr.forEach((c) => { if (c.pl > 0) w += c.pl; else l -= c.pl; }); return l === 0 ? (w > 0 ? 9 : 1) : w / l; };
  const last8 = bot.closed.slice(-8), last10 = bot.closed.slice(-10);
  let target = bot.lvl, reason = '';
  if (dd > 10) { target = 0; reason = 'Depot liegt ' + fmtPct(dd).replace('+', '') + ' unter dem Höchststand'; }
  else if (dd > 5 && target > maxLvl - 1) { target = Math.max(0, maxLvl - 1); reason = 'Rückgang von ' + fmtPct(dd).replace('+', '') + ' seit dem Höchststand'; }
  else if (now - (bot.lvlT || 0) < 24 * HOUR) { /* nach einer Änderung 24 h abwarten */ }
  else if (last8.length >= 6 && last8.filter((c) => c.pl < 0).length >= 5 && pf(last8) < 0.7) { target = Math.max(0, bot.lvl - 1); reason = 'mehrere Verlust-Trades in Folge'; }
  else if (dd < 2 && last10.length >= 6 && pf(last10) >= 1.3 && bot.lvl < maxLvl) { target = bot.lvl + 1; reason = 'Gewinne übersteigen Verluste deutlich'; }
  else if (dd < 1 && bot.lvl < maxLvl && bot.closed.length < 6) target = maxLvl;
  target = clamp(target, 0, maxLvl);
  if (target !== bot.lvl) { const up = target > bot.lvl; bot.lvl = target; bot.lvlT = now; if (reason) log('adapt', (up ? 'Risiko erhöht auf „' : 'Risiko gesenkt auf „') + LEVELS[target].n + '“: ' + reason + '.'); }
  const L = LEVELS[bot.lvl];

  /* Tagesverlust-Grenze */
  const sod = (() => { const p = KW.partsIn(now); return KW.zonedToUtc(p.y, p.mo, p.d, 0, 0, 0, KW.TZ); })();
  let dayBase = null; for (const e of bot.eq) { if (e[0] * MIN < sod) dayBase = e[1]; else break; }
  const dayLoss = dayBase ? (1 - eqNow / dayBase) * 100 : 0;
  const blocked = dayLoss > L.dll;
  if (blocked && bot.dllDay !== KW.dayKey(now)) { bot.dllDay = KW.dayKey(now); log('adapt', 'Tagesverlust-Grenze erreicht (' + fmtPct(-dayLoss) + '): heute keine neuen Käufe mehr.'); }

  /* 4) Signale suchen und bewerten */
  const cands = [];
  const shadowOpen = new Set(brain.shadow.map((s) => s.id + '|' + s.s));
  for (const id of Object.keys(market.q)) {
    const q = market.q[id];
    if (q.nc || !KW.canTrade(q, market, now)) continue;
    const { f, aux } = featOf(id);
    const sets = detect(f, aux, q.ch || 0, q.m, true);
    for (const setup of sets) {
      const pr = predict(brain, f, setup, q.m);
      const R = riskPct(setup, aux.dv, q.m);
      const evPct = pr.evR * R - 2 * feePct;
      const c = { id, q, setup, f, pr, R, evPct, score: evPct / R, dv: aux.dv };
      cands.push(c);
      if (!shadowOpen.has(id + '|' + setup) && brain.shadow.length < 700) {
        brain.shadow.push({ id, s: setup, m: q.m, reg: pr.reg, f, p0: q.p, R: r2(R), pk: 0, t0: now, maxH: SETUPS[setup].maxH, o: VARIANTS.map(() => null) });
        shadowOpen.add(id + '|' + setup);
      }
    }
  }
  // je Wert nur das beste Muster
  const best = {};
  for (const c of cands) if (!best[c.id] || c.score > best[c.id].score) best[c.id] = c;
  const ranked = Object.values(best).sort((a, b) => b.score - a.score);
  bot.ideas = ranked.slice(0, 8).map((c) => ({ i: c.id, n: c.q.n, st: c.setup, sc: r2(c.evPct), why: why(c.setup, c.f, c.q.ch, c.q.m, c.pr) }));
  const good = ranked.filter((c) => c.evPct >= L.minEV && settings.markets[c.q.m] && !(bot.cd[c.id] > now));

  /* 5) Kaufen – bei voller Kapitalnutzung wird das freie Geld vollständig verteilt */
  let bought = 0, topped = 0;
  if (settings.enabled && !blocked) {
    const equity = KW.equityOf(bot, market);
    const investCap = equity * invest;
    const minOrder = Math.max(1000, equity * 0.02);
    const valOf = (id) => { const p = bot.pos[id], q = market.q[id]; return p.q * (q ? q.p : p.p0) * KW.fxToEur(p.c, fx); };
    const invested = () => Object.keys(bot.pos).reduce((a, id) => a + valOf(id), 0);
    const exposure = (pred) => Object.keys(bot.pos).filter((id) => pred(market.q[id] || { m: bot.pos[id].m, sec: '' })).reduce((a, id) => a + valOf(id), 0);
    const plan = [];
    // Rotation: schwächste Position gegen deutlich bessere Chance tauschen
    if (good.length && (Object.keys(bot.pos).length >= L.maxPos || bot.cash < Math.max(1000, equity * 0.02)) && now - (bot.rotT || 0) > 12 * HOUR) {
      const cand = good.find((c) => !bot.pos[c.id]);
      let weak = null;
      for (const id of Object.keys(bot.pos)) {
        const p = bot.pos[id], q = market.q[id];
        if (!q || !KW.canTrade(q, market, now) || now - p.t0 < 12 * HOUR) continue;
        const g = (q.p / p.p0 - 1) * 100 / p.R;
        if (g < 0.3 && (!weak || g < weak.g)) weak = { id, g };
      }
      if (cand && weak && cand.evPct > 1.5 && cand.pr.p > 0.5) { bot.rotT = now; sell(weak.id, 'Platz gemacht für bessere Chance (' + cand.q.n + ')'); }
    }
    for (const c of good) {
      const free = Math.min(bot.cash - 2, investCap - invested());
      if (free < minOrder) break;
      const held = bot.pos[c.id];
      if (!held && Object.keys(bot.pos).length + plan.length >= L.maxPos) continue;
      if (held) { const g = (c.q.p / held.p0 - 1) * 100 / held.R; if (g <= 0.2) continue; }
      const p = c.pr.p, b = c.pr.mult > 0 ? c.pr.mult : 2.2;
      const kellyF = Math.max(0, p - (1 - p) / b);
      let size = Math.max(equity * L.rpt / c.R, investCap * L.kelly * kellyF);
      const cap = investCap * L.maxPct / 100;
      size = Math.min(size, cap - (held ? valOf(c.id) : 0));
      if (c.q.m === 'cr') size = Math.min(size, investCap * L.crMax / 100 - exposure((q) => q.m === 'cr') - plan.filter((x) => x.c.q.m === 'cr').reduce((a, x) => a + x.size, 0));
      if (c.q.sec && c.q.sec !== 'Sonstige' && c.q.sec !== 'Krypto') size = Math.min(size, investCap * 0.4 - exposure((q) => q.sec === c.q.sec));
      size = Math.min(size, free - plan.reduce((a, x) => a + x.size, 0));
      if (size < minOrder) continue;
      plan.push({ c, size, cap: cap - (held ? valOf(c.id) : 0), held: !!held });
    }
    // Vollinvestiert: Rest gleichmäßig nach Erwartung auf die geplanten Käufe verteilen
    let rest = Math.min(bot.cash - 2, investCap - invested()) - plan.reduce((a, x) => a + x.size, 0);
    if (rest > minOrder * 0.5 && plan.length) {
      for (let pass = 0; pass < 3 && rest > 50; pass++) {
        const open = plan.filter((x) => x.size < x.cap - 1);
        const wsum = open.reduce((a, x) => a + Math.max(0.05, x.c.evPct), 0);
        if (!open.length || wsum <= 0) break;
        for (const x of open) { const add = Math.min(x.cap - x.size, rest * Math.max(0.05, x.c.evPct) / wsum); x.size += add; }
        rest = Math.min(bot.cash - 2, investCap - invested()) - plan.reduce((a, x) => a + x.size, 0);
      }
    }
    for (const { c, size, held } of plan) {
      const q = c.q, px = KW.priceEur(q, fx), cr = q.m === 'cr';
      const want = size / (1 + feePct / 100);
      const qty = cr ? Math.floor(want / px * 1e6) / 1e6 : Math.floor(want / px);
      if (qty <= 0) continue;
      const val = qty * px, f = KW.fee(val, feePct);
      if (val + f > bot.cash) continue;
      bot.cash -= val + f; bot.stats.fees = r2(bot.stats.fees + f);
      const mult = c.pr.mult;
      if (held) {
        const p = bot.pos[c.id], nq = p.q + qty;
        p.p0 = +((p.p0 * p.q + q.p * qty) / nq).toPrecision(8); p.q = cr ? +nq.toFixed(6) : nq; p.cost = r2(p.cost + val + f);
        bot.trades.push({ i: c.id, n: q.s, s: 'K', q: qty, p: q.p, c: q.c, v: r2(val), f, t: now, st: p.setup, r: 'Nachgekauft: ' + SETUPS[c.setup].n });
        log('buy', 'Nachgekauft: ' + fmtQty(qty, q.m) + ' × ' + q.n + ' für ' + fmtEur(val) + ' – Position läuft im Plus und das Signal ist weiter stark.');
        topped++;
      } else {
        bot.pos[c.id] = { q: qty, p0: q.p, c: q.c, cost: r2(val + f), t0: now, st: c.setup, setup: c.setup, R: r2(c.R), mult, maxH: SETUPS[c.setup].maxH,
          sl: +(q.p * (1 - c.R / 100)).toPrecision(6), tp: mult > 0 ? +(q.p * (1 + mult * c.R / 100)).toPrecision(6) : null, tr: r2(c.R),
          pk: q.p, lp: q.p, r: why(c.setup, c.f, q.ch, q.m, c.pr), m: q.m, f: c.f, reg: c.pr.reg, ev: r2(c.evPct), pw: r2(c.pr.p) };
        bot.trades.push({ i: c.id, n: q.s, s: 'K', q: qty, p: q.p, c: q.c, v: r2(val), f, t: now, st: c.setup, r: bot.pos[c.id].r });
        log('buy', 'Gekauft: ' + fmtQty(qty, q.m) + ' × ' + q.n + ' für ' + fmtEur(val) + ' – ' + bot.pos[c.id].r + '. Erwartung ' + fmtPct(c.evPct, 2) + ', Stopp ' + fmtPct(-c.R) + (mult > 0 ? ', Ziel ' + fmtPct(mult * c.R) : ', nachgezogener Stopp') + '.');
        bought++;
      }
    }
  }

  /* 6) Lektionen aus dem Gelernten */
  for (const [key, b] of Object.entries(brain.buckets)) {
    if (b.n < 15) continue;
    const avg = b.sumR / b.n, st = avg < -0.08 ? 'avoid' : avg > 0.25 ? 'prefer' : 'neutral';
    const old = brain.status[key];
    if (old === st) continue;
    brain.status[key] = st;
    if (!old && st === 'neutral') continue;
    const [s, m, reg] = key.split('|');
    const what = '„' + SETUPS[s].n + '“ bei ' + MK[m] + ' ' + REG[reg];
    const stat = ' (' + Math.round(b.n) + ' Fälle, ' + Math.round(b.w / b.n * 100) + ' % Treffer, im Schnitt ' + (avg >= 0 ? '+' : '−') + Math.abs(avg).toFixed(2).replace('.', ',') + ' R)';
    if (st === 'avoid') log('learn', 'Gelernt: ' + what + ' verliert meistens' + stat + ' – solche Käufe lässt der Bot jetzt aus.');
    else if (st === 'prefer') log('learn', 'Gelernt: ' + what + ' funktioniert gut' + stat + ' – der Bot setzt hier jetzt mehr ein.');
    else if (old) log('learn', 'Neu bewertet: ' + what + ' ist inzwischen neutral' + stat + '.');
  }

  /* 7) Bewertung, Verlauf, Zusammenfassung für die App */
  const eqEnd = KW.equityOf(bot, market);
  if (eqEnd > bot.peak) bot.peak = eqEnd;
  const dd2 = (1 - eqEnd / bot.peak) * 100; if (dd2 > bot.maxDD) bot.maxDD = r2(dd2);
  const tm = Math.round(now / MIN), lastEq = bot.eq[bot.eq.length - 1];
  if (!lastEq || lastEq[0] < tm) bot.eq.push([tm, r2(eqEnd)]);
  if (bot.eq.length > 4000) { const keepE = bot.eq.slice(-2000), old = bot.eq.slice(0, -2000).filter((_, i) => i % 2 === 0); bot.eq = old.concat(keepE); }
  if (bot.trades.length > 500) bot.trades.splice(0, bot.trades.length - 500);
  if (bot.log.length > 200) bot.log.splice(0, bot.log.length - 200);
  for (const k of Object.keys(bot.cd)) if (bot.cd[k] < now) delete bot.cd[k];
  if (!settings.enabled && !bot.paused) log('info', 'Auto-Trader pausiert – es werden keine neuen Trades gemacht.');
  if (settings.enabled && bot.paused) log('info', 'Auto-Trader läuft wieder.');
  bot.paused = !settings.enabled;
  // Kapital-Aufteilung nach Kaufmuster
  const inv = {}; let invSum = 0;
  for (const id of Object.keys(bot.pos)) { const p = bot.pos[id], q = market.q[id]; const v = p.q * (q ? q.p : p.p0) * KW.fxToEur(p.c, fx); inv[p.setup] = (inv[p.setup] || 0) + v; invSum += v; }
  bot.w = {}; for (const k of Object.keys(inv)) bot.w[k] = r2(inv[k] / Math.max(1, eqEnd));
  bot.invest = invest;
  bot.learn = summary(brain);
  bot.equity = r2(eqEnd); bot.runs = (bot.runs || 0) + 1; bot.lastRun = now; bot.v = 2;
  return { bot, brain, events, equity: eqEnd, bought, topped, ctx };
}

export function summary(brain) {
  const setups = {};
  for (const [key, b] of Object.entries(brain.buckets)) {
    const s = key.split('|')[0]; const o = setups[s] || (setups[s] = { n: 0, w: 0, sumR: 0 });
    o.n += b.n; o.w += b.w; o.sumR += b.sumR;
  }
  const st = Object.keys(SETUPS).map((k) => {
    const o = setups[k] || { n: 0, w: 0, sumR: 0 };
    const avoid = Object.entries(brain.status).filter(([key, v]) => key.startsWith(k + '|') && v === 'avoid').length;
    const prefer = Object.entries(brain.status).filter(([key, v]) => key.startsWith(k + '|') && v === 'prefer').length;
    return { k, n: SETUPS[k].n, txt: SETUPS[k].txt, cases: Math.round(o.n), win: o.n ? r2(o.w / o.n) : null, avgR: o.n ? r2(o.sumR / o.n) : null, avoid, prefer, mult: exitMult(brain, k) };
  });
  const weights = FEATS.map((k) => [FEAT_LABELS[k], r2(brain.w[k] || 0)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return { counts: brain.counts, pre: brain.pre, acc: brain.acc.n ? r2(brain.acc.ok / brain.acc.n) : null, accN: brain.acc.n, open: brain.shadow.length, setups: st, weights };
}

/* ---------- KI-Prognose für jeden Wert ----------
   Wahrscheinlichkeits-Korridor für die nächsten Tage: Trend, Gegenbewegung bei Übertreibung,
   Marktumfeld, langfristiger Normalverlauf und die Einschätzung des lernenden Modells. */
const PRIOR_DRIFT = { us: 0.03, de: 0.025, cr: 0 }; // % pro Tag (langfristig typisch)
function logRets(closes) { const r = []; for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) r.push(Math.log(closes[i] / closes[i - 1]) * 100); return r; }
function ewmaVol(r) { if (r.length < 5) return null; let v = r.slice(0, 5).reduce((a, x) => a + x * x, 0) / 5; for (const x of r) v = 0.94 * v + 0.06 * x * x; return Math.sqrt(v); }
function sd(r) { const m = r.reduce((a, b) => a + b, 0) / r.length; return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, r.length - 1)); }
function driftParts(closes, f, m) {
  const r = logRets(closes);
  const n = Math.min(60, r.length);
  const r60 = n ? r.slice(-n).reduce((a, b) => a + b, 0) / n : 0;
  const sig = r.length >= 10 ? 0.6 * (ewmaVol(r) || sd(r)) + 0.4 * sd(r.slice(-120)) : (BASE_VOL[m] || 2);
  const parts = [];
  parts.push(['trend', clamp(0.35 * r60, -0.35 * sig, 0.35 * sig)]);
  parts.push(['rsi', -0.06 * sig * clamp(f.rsiD, -1, 1) * (Math.abs(f.rsiD) > 0.4 ? 1.5 : 0.5)]);
  parts.push(['ema', -0.03 * sig * clamp(f.emaDist, -3, 3)]);
  parts.push(['market', 0.05 * sig * clamp(f.bench + f.breadth, -2, 2)]);
  parts.push(['prior', PRIOR_DRIFT[m] || 0]);
  return { parts, sig, n: r.length };
}
function normCdf(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }

export function forecastAll(market, daily, brain, ctx, now) {
  const H = 20;
  for (const id of Object.keys(market.q)) {
    const q = market.q[id];
    const sh = KW.dailyShard(id, q);
    const d = daily[sh] && daily[sh].d && daily[sh].d[id];
    const closes = d ? d.map((x) => x[1]) : [];
    if (!closes.length || closes[closes.length - 1] !== q.p) closes.push(q.p);
    if (closes.length < 30) { delete q.fc; continue; }
    const { f, aux } = features(closes, q.ch || 0, q.h, q.m, ctx);
    const { parts, sig } = driftParts(closes, f, q.m);
    // Einschätzung des lernenden Modells (bestes erkanntes Kaufmuster)
    let best = null;
    for (const s of detect(f, aux, q.ch || 0, q.m, true)) {
      const pr = predict(brain, f, s, q.m);
      const R = riskPct(s, aux.dv, q.m);
      const days = Math.max(2, SETUPS[s].maxH / 24);
      const add = clamp(pr.evR * R / days, -0.4 * sig, 0.4 * sig) * 0.6;
      if (!best || add > best.add) best = { s, add, p: pr.p };
    }
    if (best) parts.push(['model', best.add]);
    let mu = parts.reduce((a, x) => a + x[1], 0);
    mu = clamp(mu, -0.6 * sig, 0.6 * sig);
    const s1 = sig * 1.08; // etwas breiter wegen dicker Ränder
    const pu = normCdf((mu * H) / (s1 * Math.sqrt(H)));
    // Begründungen in Klartext
    const why = [];
    const tr = parts.find((x) => x[0] === 'trend')[1];
    if (tr > 0.12 * sig) why.push(['+', 'Aufwärtstrend der letzten Wochen']); else if (tr < -0.12 * sig) why.push(['-', 'Abwärtstrend der letzten Wochen']);
    if (f.rsiD > 0.4) why.push(['-', 'kurzfristig überkauft – Rücksetzer möglich']); else if (f.rsiD < -0.4) why.push(['+', 'stark überverkauft – Erholung möglich']);
    if (f.emaDist > 1.5) why.push(['-', 'weit über dem 20-Tage-Schnitt']); else if (f.emaDist < -1.5) why.push(['+', 'weit unter dem 20-Tage-Schnitt']);
    if (f.bench + f.breadth > 0.8) why.push(['+', 'Gesamtmarkt freundlich']); else if (f.bench + f.breadth < -0.8) why.push(['-', 'Gesamtmarkt schwach']);
    if (best && best.add > 0.02) why.push(['+', 'Der Bot sieht ein Kaufsignal: „' + SETUPS[best.s].n + '“']);
    else if (best && best.add < -0.02) why.push(['-', 'Muster „' + SETUPS[best.s].n + '“ lief hier bisher meist schlecht']);
    if (sig > (BASE_VOL[q.m] || 2) * 1.6) why.push(['~', 'ungewöhnlich starke Schwankungen']);
    q.fc = { mu: r2c(mu), s: r2c(s1), pu: r2(pu), H, t: now, why: why.slice(0, 4) };
  }
}

/* Rückblick: Wie gut hätte diese Prognose in den letzten Monaten gepasst? (ohne Modell-Teil) */
export function evalForecaster(market, daily, ctx) {
  const H = 20; let n = 0, hit = 0, cover = 0;
  for (const id of Object.keys(market.q)) {
    const q = market.q[id];
    const d = daily[KW.dailyShard(id, q)]?.d?.[id];
    if (!d || d.length < 120) continue;
    const closes = d.map((x) => x[1]);
    for (let t = 60; t + H < closes.length; t += 7) {
      const hist = closes.slice(0, t + 1);
      const ch = (closes[t] / closes[t - 1] - 1) * 100;
      const { f } = features(hist, ch, null, q.m, { breadth: { [q.m]: 0 }, bench: { [q.m]: 0 }, avg: { [q.m]: 0 } });
      const { parts, sig } = driftParts(hist, f, q.m);
      const mu = clamp(parts.reduce((a, x) => a + x[1], 0), -0.6 * sig, 0.6 * sig);
      const real = Math.log(closes[t + H] / closes[t]) * 100;
      const band = 1.2816 * sig * 1.08 * Math.sqrt(H);
      if (Math.abs(mu) > 0.01) { n++; if ((mu > 0) === (real > 0)) hit++; }
      if (Math.abs(real - mu * H) <= band) cover++;
    }
  }
  void ctx;
  const total = Math.max(1, n);
  return { n, dir: r2(hit / total), cover: r2(cover / Math.max(1, n)) };
}

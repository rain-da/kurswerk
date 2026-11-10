(function () {
'use strict';
var KW = window.KW;
var TZ = 'Europe/Berlin';
var MIN = 60000, HOUR = 3600000, DAY = 86400000;

/* ---------------- Zustand ---------------- */
var S = {
  db: null, isOwner: false, mcp: null, dbState: 'loading',
  meta: null, shards: {}, market: null, bot: null, settings: null, prefs: null, manual: null, config: null,
  got: {}, view: 'start', range: '1W', detail: null, detailMode: 'h', daily: {}, dailyT: {},
  f: { mk: 'all', q: '', sort: 'gain', limit: 60 }, ana: 'us', moverTab: 'gain',
  trade: { side: 'buy', amt: '' }, confirm: null, prevPx: {}, shownEq: null, busy: false
};
var LS_KEY = 'kurswerk.prefs.v1';
var DEFAULT_PREFS = { theme: 'system', accent: 'gold', colors: 'classic', dense: false, big: false, motion: true, eurPrices: false, fav: [] };
function loadLocalPrefs() { try { var o = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
function saveLocalPrefs(p) { try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) { /* ohne Speicher weiter */ } }
S.prefs = Object.assign({}, DEFAULT_PREFS, loadLocalPrefs() || {});

/* ---------------- Formatierung ---------------- */
var NF = {};
function nf(d) { return NF[d] || (NF[d] = new Intl.NumberFormat('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function minus(s) { return s.replace(/^-/, '−'); }
function eur(x, d) { if (!isFinite(x)) return '–'; return minus(nf(d == null ? 2 : d).format(x)) + ' €'; }
function eurS(x, d) { if (!isFinite(x)) return '–'; return (x > 0 ? '+' : '') + eur(x, d); }
function pct(x, d) { if (!isFinite(x)) return '–'; if (Math.abs(x) < 0.5 * Math.pow(10, -(d == null ? 2 : d))) x = 0; return (x > 0 ? '+' : '') + minus(nf(d == null ? 2 : d).format(x)) + ' %'; }
function pxDec(p) { var a = Math.abs(p); return a >= 1 ? 2 : a >= 0.01 ? 4 : 6; }
function price(p, cur) { if (!isFinite(p)) return '–'; return nf(pxDec(p)).format(p) + (cur === 'USD' ? ' $' : ' €'); }
function qtyFmt(q, m) { return m === 'cr' ? nf(q < 1 ? 6 : 4).format(q).replace(/0+$/, '').replace(/,$/, '') : nf(0).format(q); }
function parseAmt(str, side) {
  var t = String(str == null ? '' : str).trim().replace(/\s|€/g, '');
  if (!t) return NaN;
  if (t.indexOf(',') > -1) t = t.replace(/\./g, '').replace(',', '.');
  else if (side !== 'sell' && /^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  var n = parseFloat(t);
  return isFinite(n) ? n : NaN;
}
function cls(x) { return x > 0.004 ? 'up' : x < -0.004 ? 'down' : 'flat'; }
var DTF = {};
function dtf(key, opt) { return DTF[key] || (DTF[key] = new Intl.DateTimeFormat('de-DE', Object.assign({ timeZone: TZ }, opt))); }
function tHM(ms) { return dtf('hm', { hour: '2-digit', minute: '2-digit' }).format(ms); }
function tDM(ms) { return dtf('dm', { day: '2-digit', month: '2-digit' }).format(ms); }
function tDMHM(ms) { return tDM(ms) + ', ' + tHM(ms); }
function sameDay(a, b) { return KW.dayKey(a) === KW.dayKey(b); }
function whenShort(ms) { if (!ms) return '–'; return sameDay(ms, Date.now()) ? tHM(ms) : tDMHM(ms); }
function rel(ms) {
  var d = Date.now() - ms; if (d < 0) d = 0;
  if (d < 60000) return 'gerade eben';
  if (d < HOUR) return 'vor ' + Math.round(d / MIN) + ' Min.';
  if (d < DAY) return 'vor ' + Math.round(d / HOUR) + ' Std.';
  return 'am ' + tDMHM(ms);
}
function startOfDay(ms) { var p = KW.partsIn(ms); return KW.zonedToUtc(p.y, p.mo, p.d, 0, 0, 0, TZ); }

/* Zeitplan: GitHub Actions startet etwa alle 15 Minuten (oft einige Minuten später). */
function nextRun(now) { var q = 15 * MIN; return Math.ceil(now / q) * q + 4 * MIN; }
function runningNow() { return null; }

/* ---------------- Icons ---------------- */
var I = {
  start: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h4l3-8 4 14 3-6h4"/></svg>',
  maerkte: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M17 4v16"/><rect x="4.5" y="8" width="5" height="7" rx="1.2"/><rect x="14.5" y="6" width="5" height="9" rx="1.2"/></svg>',
  analyse: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/></svg>',
  depot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/><path d="M7 6V4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V6"/></svg>',
  optionen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h3M11 17h9"/><circle cx="16" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>',
  buy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  win: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l5-5 4 4 7-7"/><path d="M15 8h5v5"/></svg>',
  loss: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8l5 5 4-4 7 7"/><path d="M15 16h5v-5"/></svg>',
  adapt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>',
  learn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  x: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  star: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  starOn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>'
};
var VIEWS = [['start', 'Übersicht'], ['maerkte', 'Märkte'], ['analyse', 'Analyse'], ['depot', 'Mein Depot'], ['optionen', 'Optionen']];
var MK = { us: 'USA', de: 'Deutschland', cr: 'Krypto' };
var STRAT = { mom: 'Momentum', trend: 'Trend', reb: 'Rebound', brk: 'Ausbruch', pb: 'Rücksetzer', rs: 'Marktführer' };
var STRAT_TXT = {
  brk: 'Kauft, wenn ein Wert über sein 20-Tage-Hoch steigt.',
  pb: 'Kauft kurze Dellen in intakten Aufwärtstrends.',
  rs: 'Kauft Werte, die seit Wochen klar besser laufen als ihr Markt.',
  mom: 'Kauft Werte, die gerade kräftig steigen, und verkauft schnell mit festem Gewinnziel.',
  trend: 'Hält Werte, die seit Tagen stetig zulegen, und sichert Gewinne mit einem nachgezogenen Stopp.',
  reb: 'Kauft starke Tagesverlierer, sobald sie wieder nach oben drehen, und verkauft nach kurzer Erholung.'
};

/* ---------------- Theme ---------------- */
var ACCENTS = { gold: ['#F5B83D', '#A86E00'], azur: ['#5AA9FF', '#1D64C8'], mint: ['#34D9B8', '#0A8A72'], koralle: ['#FF8A65', '#C2410C'], flieder: ['#B49CFF', '#6D4BD8'] };
var hostTheme = document.documentElement.getAttribute('data-theme');
var applyingTheme = false;
function applyPrefs() {
  var p = S.prefs, root = document.documentElement, a = ACCENTS[p.accent] || ACCENTS.gold;
  root.style.setProperty('--acc-d', a[0]); root.style.setProperty('--acc-l', a[1]);
  if (p.colors === 'cb') {
    root.style.setProperty('--up-d', '#5AA9FF'); root.style.setProperty('--up-l', '#1D64C8');
    root.style.setProperty('--down-d', '#FFA94D'); root.style.setProperty('--down-l', '#C25A00');
  } else { ['--up-d', '--up-l', '--down-d', '--down-l'].forEach(function (k) { root.style.removeProperty(k); }); }
  root.classList.toggle('dense', !!p.dense);
  root.classList.toggle('big', !!p.big);
  root.classList.toggle('no-motion', p.motion === false);
  applyingTheme = true;
  if (p.theme === 'dark' || p.theme === 'light') root.setAttribute('data-theme', p.theme);
  else if (hostTheme) root.setAttribute('data-theme', hostTheme); else root.removeAttribute('data-theme');
  applyingTheme = false;
}
new MutationObserver(function () {
  if (applyingTheme) return;
  var cur = document.documentElement.getAttribute('data-theme');
  if (S.prefs.theme === 'system') { hostTheme = cur; return; }
  hostTheme = cur;
  if (cur !== S.prefs.theme) applyPrefs();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
applyPrefs();

/* ---------------- Daten-Helfer ---------------- */
function Q(id) { return S.market && S.market.q[id]; }
function fx() { return (S.meta && S.meta.fx) || { EURUSD: 1.12 }; }
function pe(q) { return KW.priceEur(q, fx()); }
function canTrade(q) { return !!q && KW.canTrade(q, S.meta, Date.now()); }
function quoteAgeOk(q) { return q && q.t && Date.now() - q.t < 8 * DAY; }
function allQuotes() {
  if (!S.market) return [];
  return Object.keys(S.market.q).map(function (id) { var q = S.market.q[id]; return Object.assign({ id: id }, q); }).filter(quoteAgeOk);
}
function feePct() { return S.settings && S.settings.feePct != null ? S.settings.feePct : 0.1; }
function botEquity() { if (!S.bot) return KW.START_CASH; return S.market ? KW.equityOf(S.bot, S.market) : (S.bot.equity || S.bot.cash); }
function eqSeries() { return S.bot && S.bot.eq ? S.bot.eq.map(function (p) { return [p[0] * MIN, p[1]]; }) : []; }
function todayBase(series, start) {
  var sod = startOfDay(Date.now()), base = null;
  for (var i = 0; i < series.length; i++) { if (series[i][0] < sod) base = series[i][1]; else break; }
  return base == null ? (series.length ? series[0][1] : start) : base;
}
function manualEquity(m) {
  if (!m) return KW.START_CASH;
  var v = m.cash;
  Object.keys(m.pos || {}).forEach(function (id) { var p = m.pos[id], q = Q(id); v += p.q * (q ? pe(q) : p.p0 * KW.fxToEur(p.c, fx())); });
  return v;
}

/* ---------------- Diagramme ---------------- */
var CH = {};
var chartSeq = 0;
function chartBox(pts, opt) {
  var id = 'c' + (++chartSeq);
  CH[id] = { pts: pts, opt: opt || {} };
  return '<div class="chart" data-chart="' + id + '" style="height:' + ((opt && opt.h) || 220) + 'px"></div>';
}
function niceTicks(min, max, n) {
  if (min === max) { min -= 1; max += 1; }
  var span = max - min, step = Math.pow(10, Math.floor(Math.log10(span / n)));
  var err = span / n / step; if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
  var lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, out = [];
  for (var v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}
/* KI-Prognose: Verlauf der letzten Wochen + Korridor für die nächsten Tage */
function fcPath(q, fc, H) {
  var out = [], d = new Date(), cr = q.m === 'cr', last = Date.now(), k = 0;
  while (out.length < H) {
    last += DAY; var wd = KW.partsIn(last).wd;
    if (!cr && (wd === 0 || wd === 6)) continue;
    k++;
    var c = fc.mu * k / 100, w8 = 1.2816 * fc.s * Math.sqrt(k) / 100, w5 = 0.6745 * fc.s * Math.sqrt(k) / 100;
    out.push({ t: last, mid: q.p * Math.exp(c), lo8: q.p * Math.exp(c - w8), hi8: q.p * Math.exp(c + w8), lo5: q.p * Math.exp(c - w5), hi5: q.p * Math.exp(c + w5) });
  }
  void d;
  return out;
}
function drawFc(el, c) {
  var W = Math.max(260, el.clientWidth || 600), H = c.opt.h || 240, hist = c.pts, fut = c.opt.fut, q = c.opt.q;
  var padL = 4, padR = 62, padT = 12, padB = 24;
  var allY = hist.map(function (p) { return p[1]; }).concat(fut.map(function (f) { return f.lo8; }), fut.map(function (f) { return f.hi8; }));
  var y0 = Math.min.apply(null, allY), y1 = Math.max.apply(null, allY), pad = (y1 - y0) * 0.06 || 1; y0 -= pad; y1 += pad;
  var x0 = hist[0][0], x1 = fut[fut.length - 1].t, nowX = hist[hist.length - 1][0];
  var sx = function (x) { return padL + (x - x0) / (x1 - x0) * (W - padL - padR); };
  var sy = function (y) { return padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB); };
  var fy = function (v) { return nf(v >= 100 ? 0 : pxDec(v)).format(v); };
  var g = '';
  niceTicks(y0, y1, 4).filter(function (t) { return t >= y0 && t <= y1; }).forEach(function (t) { var y = sy(t).toFixed(1); g += '<line class="grid-l" x1="' + padL + '" x2="' + (W - padR + 6) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (W - padR + 10) + '" y="' + (+y + 4) + '">' + esc(fy(t)) + '</text>'; });
  [[x0, 'start'], [nowX, 'middle'], [x1, 'end']].forEach(function (a) { g += '<text class="ax" x="' + sx(a[0]).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + a[1] + '">' + esc(a[0] === nowX ? 'heute' : tDM(a[0])) + '</text>'; });
  var start = { t: nowX, mid: hist[hist.length - 1][1], lo8: hist[hist.length - 1][1], hi8: hist[hist.length - 1][1], lo5: hist[hist.length - 1][1], hi5: hist[hist.length - 1][1] };
  var F = [start].concat(fut);
  function band(lo, hi) { return F.map(function (f, i) { return (i ? 'L' : 'M') + sx(f.t).toFixed(1) + ' ' + sy(f[hi]).toFixed(1); }).join('') + F.slice().reverse().map(function (f) { return 'L' + sx(f.t).toFixed(1) + ' ' + sy(f[lo]).toFixed(1); }).join('') + 'Z'; }
  var up = fut[fut.length - 1].mid >= start.mid, col = up ? 'var(--up)' : 'var(--down)';
  var hd = hist.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join('');
  var md = F.map(function (f, i) { return (i ? 'L' : 'M') + sx(f.t).toFixed(1) + ' ' + sy(f.mid).toFixed(1); }).join('');
  var nx = sx(nowX).toFixed(1);
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="KI-Prognose ' + esc(q.n) + '">' + g +
    '<rect x="' + nx + '" y="' + padT + '" width="' + (W - padR - nx) + '" height="' + (H - padT - padB) + '" fill="var(--accent)" opacity=".05"/>' +
    '<line x1="' + nx + '" x2="' + nx + '" y1="' + padT + '" y2="' + (H - padB) + '" stroke="var(--line-2)" stroke-dasharray="3 4"/>' +
    '<path class="fc-band" d="' + band('lo8', 'hi8') + '" fill="var(--accent)" opacity=".13"/>' +
    '<path class="fc-band" d="' + band('lo5', 'hi5') + '" fill="var(--accent)" opacity=".22"/>' +
    '<path d="' + hd + '" fill="none" stroke="var(--fg-2)" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path class="fc-mid" d="' + md + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-dasharray="6 5" stroke-linecap="round"/>' +
    '<circle cx="' + nx + '" cy="' + sy(start.mid).toFixed(1) + '" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>' +
    '<circle cx="' + sx(fut[fut.length - 1].t).toFixed(1) + '" cy="' + sy(fut[fut.length - 1].mid).toFixed(1) + '" r="4" fill="' + col + '" stroke="var(--surface)" stroke-width="2"/>' +
    '<line class="hl" x1="0" x2="0" y1="' + padT + '" y2="' + (H - padB) + '" stroke="var(--line-2)" visibility="hidden"/>' +
    '<circle class="hd" r="4.5" fill="var(--fg)" stroke="var(--surface)" stroke-width="2" visibility="hidden"/></svg><div class="tip"></div>';
  var svg = el.querySelector('svg'), hl = el.querySelector('.hl'), hdot = el.querySelector('.hd'), tip = el.querySelector('.tip');
  var pts = hist.map(function (p) { return { t: p[0], v: p[1] }; }).concat(fut.map(function (f) { return { t: f.t, v: f.mid, f: f }; }));
  function move(ev) {
    var r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * W, best = pts[0], bd = Infinity;
    pts.forEach(function (p) { var dd = Math.abs(sx(p.t) - x); if (dd < bd) { bd = dd; best = p; } });
    var px = sx(best.t), py = sy(best.v);
    hl.setAttribute('x1', px); hl.setAttribute('x2', px); hl.setAttribute('visibility', 'visible');
    hdot.setAttribute('cx', px); hdot.setAttribute('cy', py); hdot.setAttribute('visibility', 'visible');
    tip.innerHTML = best.f ? '<b>' + esc(price(best.v, q.c)) + '</b> <span class="muted">Prognose ' + esc(tDM(best.t)) + '</span><br><span class="muted">80 %: ' + esc(price(best.f.lo8, q.c)) + ' – ' + esc(price(best.f.hi8, q.c)) + '</span>'
      : '<b>' + esc(price(best.v, q.c)) + '</b> <span class="muted">' + esc(tDM(best.t)) + '</span>';
    tip.style.left = Math.min(Math.max(px / W * r.width, 90), r.width - 90) + 'px'; tip.style.top = (py / H * r.height) + 'px';
    el.classList.add('hover');
  }
  el.addEventListener('pointermove', move); el.addEventListener('pointerdown', move);
  el.addEventListener('pointerleave', function () { el.classList.remove('hover'); hl.setAttribute('visibility', 'hidden'); hdot.setAttribute('visibility', 'hidden'); });
}
function drawCharts(root) {
  (root || document).querySelectorAll('[data-chart]').forEach(function (el) {
    var c = CH[el.getAttribute('data-chart')]; if (!c || el.__drawn) return;
    el.__drawn = true;
    if (c.opt.fut) return drawFc(el, c);
    var W = Math.max(260, el.clientWidth || 600), H = c.opt.h || 220, pts = c.pts;
    var padL = 4, padR = c.opt.axisW || 64, padT = 10, padB = 24;
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
    var y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (c.opt.base != null) { y0 = Math.min(y0, c.opt.base); y1 = Math.max(y1, c.opt.base); }
    var pad = (y1 - y0) * 0.08 || Math.abs(y1) * 0.01 || 1; y0 -= pad; y1 += pad;
    var ticks = niceTicks(y0, y1, 4).filter(function (t) { return t >= y0 && t <= y1; });
    if (x1 === x0) x1 = x0 + 1;
    var sx = function (x) { return padL + (x - x0) / (x1 - x0) * (W - padL - padR); };
    var sy = function (y) { return padT + (1 - (y - y0) / (y1 - y0)) * (H - padT - padB); };
    var last = ys[ys.length - 1], first = c.opt.base != null ? c.opt.base : ys[0];
    var col = c.opt.color || (last >= first ? 'var(--up)' : 'var(--down)');
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1); }).join('');
    var area = d + 'L' + sx(x1).toFixed(1) + ' ' + (H - padB) + 'L' + sx(x0).toFixed(1) + ' ' + (H - padB) + 'Z';
    var gid = 'g' + el.getAttribute('data-chart');
    var fy = c.opt.fmtY || function (v) { return nf(0).format(v); };
    var g = '';
    ticks.forEach(function (t) { var y = sy(t).toFixed(1); g += '<line class="grid-l" x1="' + padL + '" x2="' + (W - padR + 6) + '" y1="' + y + '" y2="' + y + '"/><text class="ax" x="' + (W - padR + 10) + '" y="' + (+y + 4) + '">' + esc(fy(t)) + '</text>'; });
    if (c.opt.base != null) { var by = sy(c.opt.base).toFixed(1); g += '<line x1="' + padL + '" x2="' + (W - padR + 6) + '" y1="' + by + '" y2="' + by + '" stroke="var(--muted)" stroke-dasharray="3 4" stroke-width="1"/>'; }
    var span = x1 - x0, fx_ = span <= 1.2 * DAY ? tHM : span <= 3 * DAY ? tDMHM : tDM;
    [0, 0.5, 1].forEach(function (f, i) {
      var xv = x0 + f * span, anchor = i === 0 ? 'start' : i === 2 ? 'end' : 'middle';
      g += '<text class="ax" x="' + sx(xv).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + anchor + '">' + esc(fx_(xv)) + '</text>';
    });
    var len = 0; for (var i = 1; i < pts.length; i++) { var dx = sx(pts[i][0]) - sx(pts[i - 1][0]), dy = sy(pts[i][1]) - sy(pts[i - 1][1]); len += Math.sqrt(dx * dx + dy * dy); }
    var endX = sx(pts[pts.length - 1][0]), endY = sy(last);
    el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="' + esc(c.opt.label || 'Verlauf') + '">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + col + '" stop-opacity=".28"/><stop offset="1" stop-color="' + col + '" stop-opacity="0"/></linearGradient></defs>' + g +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path class="draw" style="--len:' + Math.ceil(len + 2) + '" d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<circle cx="' + endX.toFixed(1) + '" cy="' + endY.toFixed(1) + '" r="4" fill="' + col + '" stroke="var(--surface)" stroke-width="2"/>' +
      '<line class="hl" x1="0" x2="0" y1="' + padT + '" y2="' + (H - padB) + '" stroke="var(--line-2)" stroke-width="1" visibility="hidden"/>' +
      '<circle class="hd" r="5" fill="' + col + '" stroke="var(--surface)" stroke-width="2" visibility="hidden"/></svg><div class="tip"></div>';
    var svg = el.querySelector('svg'), hl = el.querySelector('.hl'), hd = el.querySelector('.hd'), tip = el.querySelector('.tip');
    function move(ev) {
      var r = svg.getBoundingClientRect(); var x = (ev.clientX - r.left) / r.width * W;
      var best = 0, bd = Infinity;
      for (var k = 0; k < pts.length; k++) { var dd = Math.abs(sx(pts[k][0]) - x); if (dd < bd) { bd = dd; best = k; } }
      var p = pts[best], px = sx(p[0]), py = sy(p[1]);
      hl.setAttribute('x1', px); hl.setAttribute('x2', px); hl.setAttribute('visibility', 'visible');
      hd.setAttribute('cx', px); hd.setAttribute('cy', py); hd.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + esc((c.opt.fmtTip || fy)(p[1])) + '</b> <span class="muted">' + esc(tDMHM(p[0])) + '</span>';
      tip.style.left = Math.min(Math.max(px / W * r.width, 70), r.width - 70) + 'px'; tip.style.top = (py / H * r.height) + 'px';
      el.classList.add('hover');
    }
    function leave() { el.classList.remove('hover'); hl.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); }
    el.addEventListener('pointermove', move); el.addEventListener('pointerdown', move); el.addEventListener('pointerleave', leave);
  });
}
var rsT = null;
window.addEventListener('resize', function () { clearTimeout(rsT); rsT = setTimeout(function () { document.querySelectorAll('[data-chart]').forEach(function (el) { el.__drawn = false; }); drawCharts(); }, 180); });
function spark(h, ch) {
  if (!h || h.length < 3) return '<svg class="spark" viewBox="0 0 96 30" aria-hidden="true"><line x1="2" x2="94" y1="15" y2="15" stroke="var(--line-2)" stroke-dasharray="2 4"/></svg>';
  var pts = h.slice(-30), ys = pts.map(function (p) { return p[1]; });
  var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys); if (hi === lo) hi = lo + 1;
  var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + (2 + i / (pts.length - 1) * 92).toFixed(1) + ' ' + (27 - (p[1] - lo) / (hi - lo) * 24).toFixed(1); }).join('');
  var col = ys[ys.length - 1] >= ys[0] ? 'var(--up)' : 'var(--down)';
  return '<svg class="spark" viewBox="0 0 96 30" aria-hidden="true"><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/></svg>';
}

/* ---------------- Rahmen ---------------- */
function statusInfo() {
  var now = Date.now(), b = S.bot, st = S.settings || KW.defaultSettings();
  var running = runningNow(now), nx = nextRun(now);
  var on = st.enabled !== false;
  var lvl = b ? KW.LEVELS[b.lvl] : KW.LEVELS[2];
  return { on: on, lvl: lvl ? lvl.n : '–', running: running, next: nx, upd: S.meta ? S.meta.updatedAt : 0 };
}
function renderChrome() {
  var navHtml = VIEWS.map(function (v) {
    return '<a href="#' + v[0] + '"' + (S.view === v[0] ? ' aria-current="page"' : '') + '>' + I[v[0]] + '<span>' + v[1] + '</span></a>';
  }).join('');
  document.getElementById('nav-side').innerHTML = navHtml;
  document.getElementById('nav-tab').innerHTML = VIEWS.map(function (v) {
    return '<a href="#' + v[0] + '"' + (S.view === v[0] ? ' aria-current="page"' : '') + '>' + I[v[0]] + '<span>' + (v[0] === 'depot' ? 'Depot' : v[1]) + '</span></a>';
  }).join('');
  var si = statusInfo();
  var dot = si.running ? '<span class="dot warn live"></span>' : si.on ? '<span class="dot live"></span>' : '<span class="dot off"></span>';
  var line1 = si.running ? 'Aktualisiert gerade …' : si.on ? 'Auto-Trader aktiv' : 'Auto-Trader pausiert';
  document.getElementById('side-status').innerHTML =
    '<div class="row">' + dot + '<b>' + line1 + '</b></div>' +
    '<div class="muted">Modus: ' + esc(si.lvl) + '</div>' +
    '<div class="muted">Kurse: ' + (si.upd ? esc(rel(si.upd)) : 'noch keine') + '</div>' +
    (si.next ? '<div class="muted">Nächste Runde: ca. ' + esc(tHM(si.next)) + ' Uhr</div>' : '');
  document.getElementById('top-status').innerHTML = '<span class="pill">' + dot + '<span>' + (si.running ? 'Aktualisiert …' : si.on ? 'Bot aktiv' : 'Pausiert') + '</span></span>';
}

/* ---------------- Übersicht ---------------- */
function vStart() {
  if (!S.bot) return loadingBlock('Auto-Trader', 'Hier erscheinen Depotwert, Gewinnkurve und alle Trades des Bots, sobald die erste Runde gelaufen ist.');
  var b = S.bot, eq = botEquity(), start = b.startCash || KW.START_CASH;
  var tot = eq - start, totP = tot / start * 100;
  var series = eqSeries();
  if (series.length && S.meta && S.meta.updatedAt > series[series.length - 1][0]) series.push([S.meta.updatedAt, eq]);
  var base = todayBase(series, start), day = eq - base, dayP = base ? day / base * 100 : 0;
  var si = statusInfo();
  var rng = { '1T': DAY, '1W': 7 * DAY, '1M': 30 * DAY, 'Max': Infinity }[S.range];
  var now = Date.now();
  var pts = series.filter(function (p) { return now - p[0] <= rng; });
  if (pts.length < 2 && series.length >= 2) pts = series.slice(-2);
  var chart = pts.length >= 2 ? chartBox(pts, { h: 240, base: start, label: 'Depotwert des Auto-Traders', fmtY: function (v) { return nf(0).format(v); }, fmtTip: function (v) { return eur(v, 0); } })
    : '<div class="empty-chart"><div><b style="color:var(--fg)">Die Gewinnkurve startet gerade.</b><br>Nach jeder Kursaktualisierung kommt ein neuer Punkt dazu.</div></div>';
  var euros = Math.floor(Math.abs(eq)), cents = Math.round((Math.abs(eq) - euros) * 100);
  var hero = '<section class="card hero">' +
    '<div class="hero-top"><div><div class="eyebrow">Auto-Trader · Gesamtwert</div>' +
    '<div class="big-num num" data-count="' + eq.toFixed(2) + '">' + nf(0).format(euros) + '<span class="cents">,' + String(cents).padStart(2, '0') + ' €</span></div>' +
    '<div class="chips">' +
    '<span class="pill ' + cls(tot) + '"><span class="lbl">Gesamt</span>' + eurS(tot) + ' · ' + pct(totP) + '</span>' +
    '<span class="pill ' + cls(day) + '"><span class="lbl">Heute</span>' + eurS(day) + ' · ' + pct(dayP) + '</span>' +
    '<span class="pill acc"><span class="lbl">Modus</span>' + esc(si.lvl) + '</span>' +
    '</div></div>' +
    '<div class="seg" role="group" aria-label="Zeitraum">' + ['1T', '1W', '1M', 'Max'].map(function (r) { return '<button data-range="' + r + '" aria-pressed="' + (S.range === r) + '">' + r + '</button>'; }).join('') + '</div>' +
    '</div><div style="margin-top:14px">' + chart + '</div>' +
    '<div class="note" style="margin-top:6px">Startkapital ' + eur(start, 0) + ' (gestrichelte Linie). ' + (si.upd ? 'Kurse von ' + esc(whenShort(si.upd)) + ' Uhr' + (si.next ? ', nächste Aktualisierung ca. ' + esc(tHM(si.next)) + ' Uhr.' : '.') : '') + '</div>' +
    '</section>';

  var invested = eq - b.cash;
  var s = b.stats || {}, hit = s.n ? Math.round(s.wins / s.n * 100) + ' %' : '–';
  var kpis = '<section class="kpis">' +
    kpi(eur(b.cash, 0), 'Bargeld') + kpi(eur(invested, 0), 'Investiert (' + Object.keys(b.pos).length + ' Positionen)') +
    kpi(hit, 'Trefferquote' + (s.n ? ' (' + s.wins + ' von ' + s.n + ')' : '')) +
    kpi(eurS(s.realized || 0, 0), 'Realisierter Gewinn') + kpi(pct(-(b.maxDD || 0), 1), 'Größter Rückgang') + '</section>';

  var posRows = Object.keys(b.pos).map(function (id) {
    var p = b.pos[id], q = Q(id) || { n: id, s: id, p: p.lp || p.p0, c: p.c, m: p.m };
    var val = p.q * q.p * KW.fxToEur(p.c, fx()), pl = val - p.cost, plp = pl / p.cost * 100;
    var lo = p.sl, hi = p.tp || p.p0 * (1 + 2 * p.tr / 100);
    var pos = Math.max(0, Math.min(100, (q.p - lo) / (hi - lo) * 100));
    return { id: id, val: val, html: '<tr class="click" tabindex="0" data-open="' + esc(id) + '">' +
      '<td><div class="name-cell"><span class="tk">' + esc(q.s) + '</span><div class="nm"><b>' + esc(q.n) + '</b><small>' + esc(rel(p.t0)) + ' gekauft</small></div></div></td>' +
      '<td><span class="strat ' + p.st + '">' + STRAT[p.st] + '</span></td>' +
      '<td class="r num hide-s">' + qtyFmt(p.q, q.m) + '</td>' +
      '<td class="r num hide-s">' + price(p.p0, p.c) + '</td>' +
      '<td class="r num">' + price(q.p, q.c) + '</td>' +
      '<td class="r num">' + eur(val, 0) + '</td>' +
      '<td class="r num ' + cls(pl) + '"><b>' + eurS(pl, 0) + '</b><br><small>' + pct(plp) + '</small></td>' +
      '<td class="hide-s" title="Kurs zwischen Stop-Loss und Ziel"><div class="range"><i style="left:' + pos.toFixed(0) + '%"></i></div></td></tr>' };
  }).sort(function (a, b2) { return b2.val - a.val; });
  var positions = '<section class="card"><div class="card-head"><h2>Offene Positionen</h2><span class="sub">' + posRows.length + ' Werte · ' + eur(invested, 0) + '</span></div>' +
    (posRows.length ? '<div class="tbl-wrap"><table><thead><tr><th>Wert</th><th>Strategie</th><th class="r hide-s">Stück</th><th class="r hide-s">Kaufkurs</th><th class="r">Aktuell</th><th class="r">Wert</th><th class="r">Gewinn</th><th class="hide-s">Stopp ↔ Ziel</th></tr></thead><tbody>' + posRows.map(function (r) { return r.html; }).join('') + '</tbody></table></div>'
      : '<div class="empty"><b>Gerade keine offenen Positionen</b><span>Der Bot kauft, sobald ein Markt geöffnet ist und ein Signal stark genug ist.</span></div>') + '</section>';

  var w = b.w || {}, L = b.learn || null;
  var stats = {};
  (b.closed || []).forEach(function (c) { var o = stats[c.st] || (stats[c.st] = { n: 0, w: 0, pl: 0 }); o.n++; if (c.pl > 0) o.w++; o.pl += c.pl; });
  var keys = L && L.setups ? L.setups.map(function (x) { return x.k; }) : ['mom', 'trend', 'reb'];
  var SCOL = { trend: 'var(--up)', reb: '#8EA8FF', brk: '#F28C5B', pb: '#3CC7D6', rs: '#C08BFF' };
  var strat = '<section class="card"><div class="card-head"><h2>Kaufmuster</h2><span class="sub">wie viel vom Depot gerade in welchem Muster steckt</span></div><div class="strats">' +
    keys.map(function (k) {
      var o = stats[k] || { n: 0, w: 0, pl: 0 }, ls = L && L.setups ? L.setups.filter(function (x) { return x.k === k; })[0] : null;
      var badge = ls && ls.prefer ? ' <span class="pill up" style="padding:1px 8px;font-size:.72rem">bevorzugt</span>' : ls && ls.avoid ? ' <span class="pill down" style="padding:1px 8px;font-size:.72rem">teils gemieden</span>' : '';
      var learned = ls && ls.cases ? ' Erfahrung: ' + nf(0).format(ls.cases) + ' Fälle, ' + Math.round(ls.win * 100) + ' % Treffer, im Schnitt ' + (ls.avgR >= 0 ? '+' : '−') + nf(2).format(Math.abs(ls.avgR)) + ' R.' : '';
      return '<div class="st-row"><div class="top"><b>' + STRAT[k] + badge + '</b><span class="num"><b>' + Math.round((w[k] || 0) * 100) + ' %</b> <span class="muted">des Depots</span></span></div>' +
        '<div class="bar"><i style="width:' + Math.min(100, Math.round((w[k] || 0) * 100)) + '%;' + (SCOL[k] ? 'background:' + SCOL[k] : '') + '"></i></div>' +
        '<small>' + (STRAT_TXT[k] || '') + learned + (o.n ? ' Echte Trades: ' + o.n + ', davon ' + o.w + ' im Plus (' + eurS(o.pl, 0) + ').' : '') + '</small></div>';
    }).join('') + '<p class="note" style="margin:0">R = eingesetztes Risiko je Trade. +1 R heißt: so viel gewonnen, wie beim Stopp verloren gegangen wäre.</p></div></section>';

  var learnCard = '';
  if (L) {
    var c = L.counts || {}, tot = (c.pre || 0) + (c.shadow || 0) + (c.real || 0);
    var lessons = (b.log || []).filter(function (l) { return l.k === 'learn'; }).slice(-4).reverse();
    var ws = (L.weights || []).filter(function (x) { return Math.abs(x[1]) > 0.005; }).slice(0, 6), maxW = Math.max.apply(null, ws.map(function (x) { return Math.abs(x[1]); }).concat([0.01]));
    learnCard = '<section class="card"><div class="card-head"><h2>So lernt der Bot</h2><span class="sub">jede Runde ein bisschen schlauer</span></div>' +
      '<div class="kpis learn-kpis" style="margin-bottom:14px">' +
      kpi(nf(0).format(tot), 'ausgewertete Situationen') + kpi(nf(0).format(c.shadow || 0), 'Schatten-Trades ausgewertet') + kpi(nf(0).format(c.real || 0), 'aus echten Trades gelernt') +
      kpi(L.acc == null ? '–' : Math.round(L.acc * 100) + ' %', 'Prognosen richtig' + (L.accN ? ' (von ' + nf(0).format(L.accN) + ')' : '')) + '</div>' +
      '<p class="note" style="margin:0 0 12px">Der Bot merkt sich jedes Signal, auch die, die er nicht kauft, und prüft später, wie es ausgegangen ist. Danach passt er seine Einschätzung an. ' +
      (L.pre && L.pre.done ? 'Zum Start hat er ' + nf(0).format(L.pre.n) + ' Situationen aus einem Jahr Kursgeschichte durchgerechnet.' : 'Das Vortraining mit einem Jahr Kursgeschichte läuft in den nächsten Runden.') + ' Gerade verfolgt er ' + nf(0).format(L.open || 0) + ' Signale.</p>' +
      (ws.length ? '<div class="eyebrow" style="margin-bottom:8px">Worauf er gerade achtet</div><div class="sectors" style="margin-bottom:14px">' + ws.map(function (x) {
        var wd = Math.abs(x[1]) / maxW * 50;
        return '<div class="sec wsec"><span>' + esc(x[0]) + '</span><div class="track"><i style="' + (x[1] >= 0 ? 'left:50%;' : 'left:' + (50 - wd) + '%;') + 'width:' + wd + '%;background:var(' + (x[1] >= 0 ? '--up' : '--down') + ')"></i></div><b class="' + cls(x[1]) + '" style="text-align:right;font-size:.8rem">' + (x[1] >= 0 ? 'je höher, desto besser' : 'je höher, desto schlechter') + '</b></div>';
      }).join('') + '</div>' : '') +
      (lessons.length ? '<div class="eyebrow" style="margin-bottom:4px">Letzte Lektionen</div><div class="feed" style="max-height:none">' + lessons.map(function (l) { return '<div class="ev learn"><div class="ic">' + I.learn + '</div><div><p>' + esc(l.x) + '</p><small>' + esc(rel(l.t)) + '</small></div></div>'; }).join('') + '</div>' : '') +
      '</section>';
  }

  var ideas = (b.ideas || []).slice(0, 5);
  var watch = '<section class="card"><div class="card-head"><h2>Der Bot beobachtet</h2><span class="sub">beste Chancen der letzten Runde mit erwartetem Gewinn</span></div>' +
    (ideas.length ? ideas.map(function (it) {
      var q = Q(it.i);
      return '<div class="mv" tabindex="0" role="button" data-open="' + esc(it.i) + '"><div class="name-cell"><span class="tk">' + esc(q ? q.s : it.i) + '</span><div class="nm"><b>' + esc(it.n) + '</b><small>' + esc(it.why) + '</small></div></div><span class="chg num ' + cls(it.sc) + '" title="erwarteter Gewinn nach Kosten">' + pct(it.sc, 1) + '</span></div>';
    }).join('') : '<div class="empty"><span>Keine starken Signale – an geschlossenen Börsen wartet der Bot ab.</span></div>') + '</section>';

  var log = (b.log || []).slice(-60).reverse();
  var feed = '<section class="card"><div class="card-head"><h2>Aktivität</h2><span class="sub">' + (b.trades || []).length + ' Orders insgesamt</span></div><div class="feed">' +
    log.map(function (l) { var k = I[l.k] ? l.k : 'info'; return '<div class="ev ' + k + '"><div class="ic">' + I[k] + '</div><div><p>' + esc(l.x) + '</p><small>' + esc(rel(l.t)) + '</small></div></div>'; }).join('') + '</div></section>';

  var movers = moversMini();
  var you = '';
  if (S.manual && (S.manual.trades || []).length) {
    var me = manualEquity(S.manual), mp = (me - S.manual.startCash) / S.manual.startCash * 100;
    you = '<section class="card"><div class="card-head"><h2>Du gegen den Bot</h2></div><div class="grid-even">' +
      '<div><div class="eyebrow">Auto-Trader</div><div class="big-num num" style="font-size:1.6rem">' + pct(totP) + '</div></div>' +
      '<div><div class="eyebrow">Mein Depot</div><div class="big-num num" style="font-size:1.6rem">' + pct(mp) + '</div></div></div></section>';
  }
  return head('Übersicht', 'Der Auto-Trader handelt mit 100.000 € Spielgeld zu echten Kursen. Hier siehst du, wie viel Geld er gerade machen würde.') +
    hero + kpis + positions + learnCard + '<div class="grid-2"><div class="stack">' + feed + '</div><div class="stack">' + strat + watch + you + movers + '</div></div>' + disclaimer();
}
function kpi(v, l) { return '<div class="kpi"><b class="num">' + v + '</b><span>' + esc(l) + '</span></div>'; }
function head(t, p, right) { return '<div class="pagehead"><div><h1>' + esc(t) + '</h1>' + (p ? '<p>' + esc(p) + '</p>' : '') + '</div>' + (right || '') + '</div>'; }
function disclaimer() { return '<p class="disclaimer">Spielgeld-Simulation mit echten, leicht verzögerten Kursen. Keine Anlageberatung, kein echtes Geld.</p>'; }
function loadingBlock(title, txt) {
  var msg = S.dbState === 'none' ? 'Es sind noch keine Daten veröffentlicht. Sobald die erste Bot-Runde auf GitHub gelaufen ist (wenige Minuten nach dem Einrichten), erscheinen sie hier.'
    : S.dbState === 'slow' ? 'Der Datenspeicher antwortet gerade nicht. Die App versucht es weiter.' : txt;
  return head(title, '') + '<section class="card"><div class="empty"><b>' + (S.dbState === 'loading' ? 'Lade Daten …' : S.dbState === 'none' ? 'Noch keine Daten' : S.dbState === 'slow' ? 'Verbindung dauert länger' : 'Noch keine Daten') + '</b><span>' + esc(msg) + '</span>' +
    (S.dbState === 'loading' ? '<div class="skel" style="width:100%;max-width:420px;height:12px;margin-top:8px"></div><div class="skel" style="width:70%;max-width:300px;height:12px"></div>' : '') + '</div></section>';
}
function moversMini() {
  var qs = allQuotes().filter(function (q) { return !q.nc && (q.m !== 'cr' ? sameDay(q.t, latestT(q.m)) : true); });
  if (!qs.length) return '';
  qs.sort(function (a, b) { return b.ch - a.ch; });
  var top = qs.slice(0, 4), flop = qs.slice(-3).reverse();
  return '<section class="card"><div class="card-head"><h2>Heute im Fokus</h2><a class="sub" href="#analyse" style="color:var(--accent)">Zur Analyse →</a></div>' +
    top.concat(flop).map(function (q) {
      return '<div class="mv" tabindex="0" role="button" data-open="' + esc(q.id) + '"><div class="name-cell"><span class="tk">' + esc(q.s) + '</span><div class="nm"><b>' + esc(q.n) + '</b><small>' + MK[q.m] + '</small></div></div><span class="chg num ' + cls(q.ch) + '">' + pct(q.ch) + '</span></div>';
    }).join('') + '</section>';
}
var _lt = {};
function latestT(m) {
  if (_lt[m] && _lt[m].src === S.market) return _lt[m].t;
  var t = 0; if (S.market) Object.keys(S.market.q).forEach(function (id) { var q = S.market.q[id]; if (q.m === m && q.t > t) t = q.t; });
  _lt[m] = { src: S.market, t: t }; return t;
}

/* ---------------- Märkte ---------------- */
function vMarkets() {
  if (!S.market) return loadingBlock('Märkte', 'Hier erscheinen über 500 Aktien aus den USA und Deutschland und die wichtigsten Kryptowährungen.');
  var mac = (S.meta && S.meta.macro) || {};
  var order = [['DAX', 'DAX'], ['SPX', 'S&P 500'], ['DJI', 'Dow Jones'], ['NDX', 'Nasdaq 100'], ['SX5E', 'Euro Stoxx 50'], ['SMI', 'SMI'], ['GOLD', 'Gold ($/Unze)'], ['OIL', 'Öl Brent ($)'], ['EURUSD', 'Euro in Dollar']];
  var idx = '<section class="idx">' + order.filter(function (o) { return mac[o[0]]; }).map(function (o) {
    var m = mac[o[0]], d = o[0] === 'EURUSD' ? 4 : m.v < 100 ? 2 : 0;
    return '<div class="it"><span>' + esc(o[1]) + '</span><b class="num">' + nf(d).format(m.v) + '</b><em class="num ' + cls(m.ch) + '">' + pct(m.ch) + '</em></div>';
  }).join('') + '</section>';
  var counts = { all: 0, us: 0, de: 0, cr: 0, fav: 0 };
  var fav = S.prefs.fav || [];
  allQuotes().forEach(function (q) { counts.all++; counts[q.m]++; if (fav.indexOf(q.id) > -1) counts.fav++; });
  var tools = '<div class="toolbar">' +
    '<label class="search">' + I.search + '<input id="q-search" type="search" placeholder="Aktie oder Krypto suchen, z. B. Apple, SAP, Bitcoin" value="' + esc(S.f.q) + '" autocomplete="off" aria-label="Suchen"></label>' +
    '<div class="seg" role="group" aria-label="Markt">' + [['all', 'Alle'], ['us', 'USA'], ['de', 'Deutschland'], ['cr', 'Krypto'], ['fav', '★ Merkliste']].map(function (o) {
      return '<button data-mk="' + o[0] + '" aria-pressed="' + (S.f.mk === o[0]) + '">' + o[1] + ' <span class="muted num">' + counts[o[0]] + '</span></button>';
    }).join('') + '</div>' +
    '<select class="sel" id="q-sort" aria-label="Sortierung">' + [['gain', 'Größte Gewinner'], ['loss', 'Größte Verlierer'], ['name', 'Name A–Z'], ['price', 'Höchster Preis']].map(function (o) {
      return '<option value="' + o[0] + '"' + (S.f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select></div>';
  return head('Märkte', 'Echte Kurse von Börsen in den USA und Deutschland sowie Kryptowährungen. Tippe auf einen Wert für Chart, Details und Handel.') +
    idx + '<section class="card">' + tools + '<div id="qlist" style="margin-top:12px"></div></section>' + disclaimer();
}
function filteredQuotes() {
  var qs = allQuotes(), f = S.f, term = f.q.trim().toLowerCase(), fav = S.prefs.fav || [];
  if (f.mk === 'fav') qs = qs.filter(function (q) { return fav.indexOf(q.id) > -1; });
  else if (f.mk !== 'all') qs = qs.filter(function (q) { return q.m === f.mk; });
  if (term) qs = qs.filter(function (q) { return (q.n + ' ' + q.s + ' ' + (q.sec || '')).toLowerCase().indexOf(term) > -1; });
  var by = { gain: function (a, b) { return b.ch - a.ch; }, loss: function (a, b) { return a.ch - b.ch; }, name: function (a, b) { return a.n.localeCompare(b.n, 'de'); }, price: function (a, b) { return pe(b) - pe(a); } }[f.sort];
  return qs.sort(by);
}
function renderList() {
  var box = document.getElementById('qlist'); if (!box) return;
  var qs = filteredQuotes(), shown = qs.slice(0, S.f.limit);
  if (!qs.length) { box.innerHTML = '<div class="empty"><b>' + (S.f.mk === 'fav' ? 'Deine Merkliste ist leer' : 'Nichts gefunden') + '</b><span>' + (S.f.mk === 'fav' ? 'Öffne einen Wert und tippe auf den Stern.' : 'Probiere einen anderen Namen oder ein Kürzel.') + '</span></div>'; return; }
  var eurP = S.prefs.eurPrices;
  box.innerHTML = '<div class="qlist" role="list">' + shown.map(function (q) {
    var prev = S.prevPx[q.id], fl = prev != null && prev !== q.p ? (q.p > prev ? ' flash-up' : ' flash-down') : '';
    S.prevPx[q.id] = q.p;
    var stand = q.m === 'cr' ? '24 h' : whenShort(q.t);
    return '<button class="qrow' + fl + '" role="listitem" data-open="' + esc(q.id) + '">' +
      '<div class="name-cell"><span class="tk">' + esc(q.s) + '</span><div class="nm"><b>' + esc(q.n) + '</b><small>' + MK[q.m] + (q.sec && q.sec !== 'Sonstige' && q.sec !== 'Krypto' ? ' · ' + esc(q.sec) : '') + '</small></div></div>' +
      spark(q.h, q.ch) +
      '<div class="px num"><b>' + (eurP ? eur(pe(q), pxDec(pe(q))) : price(q.p, q.c)) + '</b><small>' + esc(stand) + '</small></div>' +
      (q.nc ? '<span class="chg num flat">–</span>' : '<span class="chg num ' + cls(q.ch) + '">' + pct(q.ch) + '</span>') + '</button>';
  }).join('') + '</div>' +
    (qs.length > shown.length ? '<button class="more" data-more="1">Weitere ' + Math.min(60, qs.length - shown.length) + ' von ' + (qs.length - shown.length) + ' anzeigen</button>' : '');
}

/* ---------------- Analyse ---------------- */
function marketStats(m) {
  var lt = latestT(m);
  var qs = allQuotes().filter(function (q) { return q.m === m && !q.nc && (m === 'cr' || sameDay(q.t, lt)); });
  var n = qs.length; if (!n) return null;
  var up = 0, down = 0, sum = 0;
  qs.forEach(function (q) { if (q.ch > 0.05) up++; else if (q.ch < -0.05) down++; sum += q.ch; });
  qs.sort(function (a, b) { return b.ch - a.ch; });
  return { m: m, n: n, up: up, down: down, flat: n - up - down, avg: sum / n, best: qs[0], worst: qs[n - 1], qs: qs, t: lt };
}
function moodOf(avg, upShare) {
  if (avg > 1.2 && upShare > .65) return ['Sehr starker Tag', 'up'];
  if (avg > 0.3) return ['Freundlich', 'up'];
  if (avg > -0.3) return ['Gemischt', 'flat'];
  if (avg > -1.2) return ['Schwach', 'down'];
  return ['Deutliche Verluste', 'down'];
}
function storyFor(s) {
  var name = { us: 'An der Wall Street', de: 'In Deutschland', cr: 'Bei Kryptowährungen' }[s.m];
  var when = s.m === 'cr' ? 'in den letzten 24 Stunden' : (KW.isOpen(s.m, Date.now()) ? 'heute bisher' : (sameDay(s.t, Date.now()) ? 'heute' : 'am ' + tDM(s.t)));
  var share = s.up / s.n;
  var tone = share > .7 ? 'ging es breit nach oben' : share > .55 ? 'überwogen die Gewinner' : share > .45 ? 'hielten sich Gewinner und Verlierer die Waage' : share > .3 ? 'überwogen die Verlierer' : 'ging es breit nach unten';
  return name + ' ' + tone + ' ' + when + ': ' + s.up + ' von ' + s.n + ' Werten stiegen, im Schnitt ' + pct(s.avg) + '. Am stärksten lief ' + s.best.n + ' (' + pct(s.best.ch) + '), am schwächsten ' + s.worst.n + ' (' + pct(s.worst.ch) + ').';
}
function heatColor(ch) { var k = Math.min(1, Math.abs(ch) / 4); var pctv = Math.round(18 + k * 62); return 'color-mix(in srgb, var(' + (ch >= 0 ? '--up' : '--down') + ') ' + pctv + '%, var(--surface-3))'; }
function vAnalyse() {
  if (!S.market) return loadingBlock('Analyse', 'Hier erscheint die tägliche Auswertung: Gewinner, Verlierer, Branchen und Stimmung.');
  var all = ['us', 'de', 'cr'].map(marketStats).filter(Boolean);
  if (!all.length) return loadingBlock('Analyse', 'Sobald Kurse da sind, erscheint hier die Tagesauswertung.');
  var summary = '<section class="card"><div class="card-head"><h2>Kurz gesagt</h2><span class="sub">automatisch aus den aktuellen Kursen erstellt</span></div><div class="stack">' +
    all.map(function (s) {
      var md = moodOf(s.avg, s.up / s.n);
      return '<div class="st-row"><div class="mood"><span class="eyebrow">' + MK[s.m] + '</span><span class="mood-badge ' + md[1] + '">' + md[0] + '</span></div>' +
        '<div class="breadth" title="' + s.up + ' steigend, ' + s.down + ' fallend"><i class="u" style="width:' + (s.up / s.n * 100) + '%"></i><i class="f" style="width:' + (s.flat / s.n * 100) + '%"></i><i class="d" style="width:' + (s.down / s.n * 100) + '%"></i></div>' +
        '<p class="story">' + esc(storyFor(s)) + '</p></div>';
    }).join('') + '</div></section>';
  var s = marketStats(S.ana) || all[0];
  var tabs = '<div class="seg" role="group" aria-label="Markt">' + all.map(function (x) { return '<button data-ana="' + x.m + '" aria-pressed="' + (s.m === x.m) + '">' + MK[x.m] + '</button>'; }).join('') + '</div>';
  function list(arr) {
    return arr.map(function (q) {
      return '<div class="mv" tabindex="0" role="button" data-open="' + esc(q.id) + '"><div class="name-cell"><span class="tk">' + esc(q.s) + '</span><div class="nm"><b>' + esc(q.n) + '</b><small class="num">' + price(q.p, q.c) + '</small></div></div><span class="chg num ' + cls(q.ch) + '">' + pct(q.ch) + '</span></div>';
    }).join('');
  }
  var movers = '<section class="card"><div class="card-head"><h2>Bestperformer und Verlierer</h2>' + tabs + '</div><div class="movers">' +
    '<div><div class="eyebrow" style="margin-bottom:6px">Top 8 Gewinner</div>' + list(s.qs.slice(0, 8)) + '</div>' +
    '<div><div class="eyebrow" style="margin-bottom:6px">Top 8 Verlierer</div>' + list(s.qs.slice(-8).reverse()) + '</div></div></section>';
  var heatQs = s.m === 'us' ? s.qs.filter(function (q) { return q.sec !== 'Sonstige'; }).slice(0) : s.qs.slice(0);
  heatQs = s.m === 'us' && heatQs.length > 60 ? heatQs.slice(0, 30).concat(heatQs.slice(-30)) : heatQs.slice(0, 60);
  var heat = '<section class="card"><div class="card-head"><h2>Heatmap ' + MK[s.m] + '</h2><span class="sub">' + (s.m === 'us' ? 'bekannte US-Werte' : s.m === 'de' ? 'alle DAX-Werte' : 'größte Coins') + ', sortiert nach Tagesänderung</span></div><div class="heat">' +
    heatQs.map(function (q) { return '<button data-open="' + esc(q.id) + '" style="background:' + heatColor(q.ch) + ';color:var(--fg)" title="' + esc(q.n) + '"><b>' + esc(q.s) + '</b><span class="num">' + pct(q.ch, 1) + '</span></button>'; }).join('') + '</div></section>';
  var secs = {};
  allQuotes().forEach(function (q) {
    if (q.m === 'cr' || !q.sec || q.sec === 'Sonstige' || !sameDay(q.t, latestT(q.m))) return;
    var o = secs[q.sec] || (secs[q.sec] = { n: 0, sum: 0 }); o.n++; o.sum += q.ch;
  });
  var secArr = Object.keys(secs).filter(function (k) { return secs[k].n >= 3; }).map(function (k) { return [k, secs[k].sum / secs[k].n, secs[k].n]; }).sort(function (a, b) { return b[1] - a[1]; });
  var maxAbs = Math.max.apply(null, secArr.map(function (x) { return Math.abs(x[1]); }).concat([1]));
  var sectors = '<section class="card"><div class="card-head"><h2>Branchen im Vergleich</h2><span class="sub">Durchschnitt USA + Deutschland</span></div><div class="sectors">' +
    secArr.map(function (x) {
      var w = Math.abs(x[1]) / maxAbs * 50;
      return '<div class="sec"><span>' + esc(x[0]) + ' <span class="muted">(' + x[2] + ')</span></span><div class="track"><i style="' + (x[1] >= 0 ? 'left:50%;' : 'left:' + (50 - w) + '%;') + 'width:' + w + '%;background:var(' + (x[1] >= 0 ? '--up' : '--down') + ')"></i></div><b class="num ' + cls(x[1]) + '" style="text-align:right">' + pct(x[1], 1) + '</b></div>';
    }).join('') + '</div></section>';
  var help = '<section class="card"><div class="card-head"><h2>So liest du die Zahlen</h2></div><div class="stack note" style="font-size:.9rem">' +
    '<p style="margin:0"><b style="color:var(--fg)">Tagesänderung:</b> wie viel Prozent ein Wert seit dem letzten Handelsschluss gewonnen oder verloren hat. Bei Krypto zählen die letzten 24 Stunden.</p>' +
    '<p style="margin:0"><b style="color:var(--fg)">Marktbreite:</b> der Balken zeigt, wie viele Werte steigen (grün) und fallen (rot). Viel Grün heißt: Der Anstieg wird von vielen getragen.</p>' +
    '<p style="margin:0"><b style="color:var(--fg)">Kursstand:</b> Kurse sind bis zu 20 Minuten verzögert und werden mehrmals täglich automatisch geholt.</p></div></section>';
  return head('Analyse', 'Die wichtigsten Bewegungen des Tages, einfach erklärt.') + summary + movers + '<div class="grid-even">' + heat + '<div class="stack">' + sectors + help + '</div></div>' + disclaimer();
}

/* ---------------- Mein Depot ---------------- */
function newManual() { return { v: 1, startCash: KW.START_CASH, cash: KW.START_CASH, pos: {}, trades: [], createdAt: Date.now() }; }
function vDepot() {
  if (!S.got.manual && S.dbState !== 'none') return loadingBlock('Mein Depot', 'Dein eigenes Spielgeld-Depot mit 100.000 €.');
  var m = S.manual || newManual();
  var eq = manualEquity(m), tot = eq - m.startCash, totP = tot / m.startCash * 100;
  var rows = Object.keys(m.pos).map(function (id) {
    var p = m.pos[id], q = Q(id) || { n: id, s: id, p: p.p0, c: p.c, m: p.m };
    var val = p.q * q.p * KW.fxToEur(p.c, fx()), pl = val - p.cost;
    return '<tr class="click" tabindex="0" data-open="' + esc(id) + '"><td><div class="name-cell"><span class="tk">' + esc(q.s) + '</span><div class="nm"><b>' + esc(q.n) + '</b><small>' + MK[q.m || p.m] + '</small></div></div></td>' +
      '<td class="r num hide-s">' + qtyFmt(p.q, q.m) + '</td><td class="r num hide-s">' + price(p.p0, p.c) + '</td><td class="r num">' + price(q.p, q.c) + '</td>' +
      '<td class="r num">' + eur(val, 0) + '</td><td class="r num ' + cls(pl) + '"><b>' + eurS(pl, 0) + '</b><br><small>' + pct(pl / p.cost * 100) + '</small></td></tr>';
  });
  var bStart = (S.bot && S.bot.startCash) || KW.START_CASH, bEq = botEquity(), bP = (bEq - bStart) / bStart * 100;
  var hero = '<section class="card hero"><div class="hero-top"><div><div class="eyebrow">Mein Depot · Gesamtwert</div><div class="big-num num">' + eur(eq) + '</div>' +
    '<div class="chips"><span class="pill ' + cls(tot) + '"><span class="lbl">Gesamt</span>' + eurS(tot) + ' · ' + pct(totP) + '</span>' +
    '<span class="pill"><span class="lbl">Bargeld</span>' + eur(m.cash, 0) + '</span>' +
    '<span class="pill ' + cls(bP - totP) + '"><span class="lbl">Bot</span>' + pct(bP) + '</span></div></div></div>' +
    '<p class="note" style="margin:12px 0 0">Handle selbst mit 100.000 € Spielgeld und vergleiche dich mit dem Auto-Trader. Öffne dazu einen Wert unter <a href="#maerkte" style="color:var(--accent)">Märkte</a> und tippe auf Kaufen. Gebühr: ' + nf(2).format(feePct()) + ' % je Order, mindestens 1 €.</p></section>';
  var table = '<section class="card"><div class="card-head"><h2>Meine Positionen</h2><span class="sub">' + rows.length + ' Werte</span></div>' +
    (rows.length ? '<div class="tbl-wrap"><table><thead><tr><th>Wert</th><th class="r hide-s">Stück</th><th class="r hide-s">Kaufkurs</th><th class="r">Aktuell</th><th class="r">Wert</th><th class="r">Gewinn</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
      : '<div class="empty"><b>Noch keine eigenen Käufe</b><span>Such dir unter Märkte einen Wert aus – zum Beispiel einen der Tagesgewinner.</span><a class="btn pri" href="#maerkte" style="margin-top:8px;text-decoration:none">Zu den Märkten</a></div>') + '</section>';
  var hist = (m.trades || []).slice(-40).reverse();
  var orders = '<section class="card"><div class="card-head"><h2>Meine Orders</h2></div>' + (hist.length ? '<div class="feed">' + hist.map(function (t) {
    var k = t.s === 'K' ? 'buy' : t.pl >= 0 ? 'win' : 'loss';
    return '<div class="ev ' + k + '"><div class="ic">' + I[k] + '</div><div><p>' + (t.s === 'K' ? 'Gekauft: ' : 'Verkauft: ') + esc(qtyFmt(t.q, t.m)) + ' × ' + esc(t.n) + ' zu ' + price(t.p, t.c) + ' (' + eur(t.v) + ')' + (t.s === 'V' ? ' – Ergebnis ' + eurS(t.pl) : '') + '</p><small>' + esc(rel(t.t)) + '</small></div></div>';
  }).join('') + '</div>' : '<div class="empty"><span>Hier erscheinen deine Käufe und Verkäufe.</span></div>') + '</section>';
  var reset = S.isOwner ? '<section class="card"><div class="opt"><div class="txt"><b>Depot zurücksetzen</b><small>Verkauft nichts, sondern startet neu mit 100.000 € Bargeld.</small></div>' + confirmBtn('reset-manual', 'Zurücksetzen') + '</div></section>' : '';
  return head('Mein Depot', 'Dein eigenes Spielgeld-Konto. Wer macht mehr daraus – du oder der Bot?') + hero + '<div class="grid-2"><div class="stack">' + table + '</div><div class="stack">' + orders + reset + '</div></div>' + disclaimer();
}
function confirmBtn(key, label) {
  if (S.confirm === key) return '<div class="confirm"><span class="note warn">Wirklich?</span><button class="btn danger" data-act="' + key + '">Ja, ' + label.toLowerCase() + '</button><button class="btn" data-cancel="1">Abbrechen</button></div>';
  return '<button class="btn danger" data-ask="' + key + '">' + label + '</button>';
}

/* ---------------- Optionen ---------------- */
function vOptions() {
  var p = S.prefs, st = Object.assign(KW.defaultSettings(), S.settings || {});
  st.markets = Object.assign({ us: true, de: true, cr: true }, st.markets || {});
  var ro = !S.isOwner;
  function seg(key, opts, cur) { return '<div class="seg" role="group">' + opts.map(function (o) { return '<button data-pref="' + key + '" data-val="' + o[0] + '" aria-pressed="' + (String(cur) === String(o[0])) + '">' + o[1] + '</button>'; }).join('') + '</div>'; }
  function sw(attr, on, label) { return '<button class="switch" role="switch" aria-label="' + esc(label) + '" aria-checked="' + !!on + '" ' + attr + '></button>'; }
  var design = '<section class="card"><div class="card-head"><h2>Aussehen</h2><span class="sub">' + (window.KWFREE && window.KWFREE.connected() ? 'gilt auf all deinen Geräten' : 'gilt auf diesem Gerät') + '</span></div>' +
    '<div class="opt"><div class="txt"><b>Farbmodus</b><small>Hell, dunkel oder wie dein Gerät</small></div>' + seg('theme', [['system', 'Automatisch'], ['light', 'Hell'], ['dark', 'Dunkel']], p.theme) + '</div>' +
    '<div class="opt"><div class="txt"><b>Akzentfarbe</b><small>Für Knöpfe, Markierungen und Diagramme</small></div><div class="swatches">' + Object.keys(ACCENTS).map(function (k) { return '<button data-pref="accent" data-val="' + k + '" aria-label="' + k + '" aria-pressed="' + (p.accent === k) + '" style="background:' + ACCENTS[k][0] + '"></button>'; }).join('') + '</div></div>' +
    '<div class="opt"><div class="txt"><b>Farben für Plus und Minus</b><small>Blau/Orange ist bei Rot-Grün-Schwäche leichter zu unterscheiden</small></div>' + seg('colors', [['classic', 'Grün / Rot'], ['cb', 'Blau / Orange']], p.colors) + '</div>' +
    '<div class="opt"><div class="txt"><b>Schriftgröße</b></div>' + seg('big', [['false', 'Normal'], ['true', 'Groß']], p.big) + '</div>' +
    '<div class="opt"><div class="txt"><b>Kompakte Ansicht</b><small>Weniger Abstand, mehr auf einen Blick</small></div>' + sw('data-toggle="dense"', p.dense, 'Kompakte Ansicht') + '</div>' +
    '<div class="opt"><div class="txt"><b>Animationen</b></div>' + sw('data-toggle="motion"', p.motion !== false, 'Animationen') + '</div>' +
    '<div class="opt"><div class="txt"><b>US-Kurse in Euro anzeigen</b><small>Sonst in Dollar, wie an der Börse</small></div>' + sw('data-toggle="eurPrices"', p.eurPrices, 'US-Kurse in Euro') + '</div></section>';
  var bot = '<section class="card"><div class="card-head"><h2>Auto-Trader</h2><span class="sub">Änderungen wirken ab der nächsten Runde</span></div>' +
    (window.KWFREE && !window.KWFREE.connected() ? '<p class="note warn">Ohne verbundenes GitHub gelten Bot-Einstellungen nur hier und erreichen den Bot nicht. Verbinde dein Gerät unten unter „Geräte verbinden“.</p>' : '') +
    '<div class="opt"><div class="txt"><b>Automatisch handeln</b><small>Der Bot kauft und verkauft selbstständig mit dem Spielgeld</small></div>' + (ro ? '' : sw('data-bot="enabled"', st.enabled !== false, 'Automatisch handeln')) + '</div>' +
    '<div class="opt"><div class="txt"><b>Höchstes Risiko</b><small>Der Bot geht von selbst vorsichtiger vor, wenn es schlecht läuft – aber nie über diese Stufe hinaus</small></div>' + (ro ? '' : '<div class="seg" role="group">' + [['niedrig', 'Vorsichtig'], ['mittel', 'Ausgewogen'], ['hoch', 'Aggressiv']].map(function (o) { return '<button data-bot="risk" data-val="' + o[0] + '" aria-pressed="' + (st.risk === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>') + '</div>' +
    '<div class="opt"><div class="txt"><b>Märkte</b><small>Wo der Bot handeln darf</small></div>' + (ro ? '' : '<div class="checks">' + ['us', 'de', 'cr'].map(function (k) { return '<button data-bot="market" data-val="' + k + '" aria-pressed="' + !!st.markets[k] + '">' + MK[k] + '</button>'; }).join('') + '</div>') + '</div>' +
    '<div class="opt"><div class="txt"><b>Kapitaleinsatz</b><small>Wie viel vom Depot der Bot investieren darf. Bei „Alles“ verteilt er das komplette Geld auf die besten Chancen.</small></div>' + (ro ? '' : '<div class="seg" role="group">' + [[0.5, '50 %'], [0.75, '75 %'], [0.9, '90 %'], [1, 'Alles']].map(function (o) { return '<button data-bot="invest" data-val="' + o[0] + '" aria-pressed="' + (+(st.invest == null ? 1 : st.invest) === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>') + '</div>' +
    '<div class="opt"><div class="txt"><b>Startkapital</b><small>Mit wie viel Spielgeld der Bot beim nächsten Neustart beginnt. Aktuell: ' + eur((S.bot && S.bot.startCash) || 100000, 0) + '.</small></div>' + (ro ? '' : '<div class="checks">' + [10000, 50000, 100000, 250000, 1000000].map(function (v) { return '<button data-bot="capital" data-val="' + v + '" aria-pressed="' + (+(st.capital || 100000) === v) + '">' + (v >= 1000000 ? '1 Mio. €' : nf(0).format(v) + ' €') + '</button>'; }).join('') + '</div>') + '</div>' +
    '<div class="opt"><div class="txt"><b>Ordergebühr</b><small>Realistische Kosten je Kauf und Verkauf (mindestens 1 €)</small></div>' + (ro ? '' : '<div class="seg" role="group">' + [[0, '0 %'], [0.1, '0,1 %'], [0.25, '0,25 %']].map(function (o) { return '<button data-bot="fee" data-val="' + o[0] + '" aria-pressed="' + (+st.feePct === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>') + '</div>' +
    (ro ? '' : '<div class="opt"><div class="txt"><b>Auto-Trader neu starten</b><small>Löscht Positionen und Verlauf beim nächsten Lauf und startet mit dem eingestellten Startkapital neu. Das Gelernte bleibt erhalten.</small></div>' + confirmBtn('reset-bot', 'Neu starten') + '</div>') +
    (S.settings && S.settings.resetAt && S.bot && S.settings.resetAt > S.bot.createdAt ? '<p class="note warn">Neustart ist vorgemerkt und passiert bei der nächsten Runde.</p>' : '') + '</section>';
  var si = statusInfo(), src = (S.meta && S.meta.srcOk) || {};
  var F = window.KWFREE, conn = F && F.connected();
  var last = S.prefs.lastRefresh || 0, cool = Date.now() - last < 10 * MIN;
  var data = '<section class="card"><div class="card-head"><h2>Daten und Aktualisierung</h2></div>' +
    '<div class="opt"><div class="txt"><b>Letzte Aktualisierung</b><small>' + (si.upd ? esc(tDMHM(si.upd)) + ' Uhr · ' + (src.us || 0) + ' US-Kurse, ' + (src.de || 0) + ' deutsche, ' + (src.cr || 0) + ' Krypto' : 'noch keine') + '</small></div></div>' +
    '<div class="opt"><div class="txt"><b>Zeitplan</b><small>Der Bot läuft kostenlos auf GitHub, etwa alle 15 Minuten rund um die Uhr (GitHub startet manchmal ein paar Minuten später). Die App lädt neue Daten jede Minute.</small></div></div>' +
    (conn ? '<div class="opt"><div class="txt"><b>Jetzt aktualisieren</b><small>Startet sofort eine zusätzliche Runde. Ergebnis nach etwa 1–3 Minuten.</small></div><button class="btn" data-act="refresh"' + (cool ? ' disabled' : '') + '>' + (cool ? 'Gerade gestartet' : 'Kurse holen') + '</button></div>' : '') +
    '<div class="opt"><div class="txt"><b>Quellen</b><small>Aktien, Indizes, Gold, Öl und Euro-Kurs: Yahoo Finance (bis 15 Min. verzögert). Krypto: CoinGecko.</small></div></div></section>';
  var ghCard = '<section class="card"><div class="card-head"><h2>Geräte verbinden</h2><span class="sub">' + (conn ? '<span class="up">verbunden</span>' : 'optional') + '</span></div>' +
    '<p class="note" style="margin:0 0 10px">Den Bot und seine Kurve siehst du auf jedem Gerät automatisch. Damit auch Bot-Einstellungen, dein eigenes Depot und das Aussehen auf Handy und PC gleich sind, trag hier einmal pro Gerät deinen GitHub-Schlüssel ein (Anleitung in der README).</p>' +
    '<div class="field"><label for="gh-repo">Repository</label><input class="inp" id="gh-repo" placeholder="deinname/kurswerk" value="' + esc((F && F.cfg.repo) || '') + '" autocomplete="off"></div>' +
    '<div class="field" style="margin-top:10px"><label for="gh-token">GitHub-Schlüssel (Token)</label><input class="inp" id="gh-token" type="password" placeholder="github_pat_…" value="' + esc((F && F.cfg.token) || '') + '" autocomplete="off"></div>' +
    '<div class="confirm" style="margin-top:12px"><button class="btn pri" data-act="gh-save">Speichern</button>' + (conn ? '<button class="btn" data-act="gh-clear">Trennen</button>' : '') + '</div>' +
    '<p class="note" style="margin:10px 0 0">Der Schlüssel bleibt nur in diesem Browser gespeichert.</p></section>';
  var about = '<section class="card"><div class="card-head"><h2>Wichtig</h2></div><p class="note" style="margin:0">Kurswerk ist eine Simulation mit Spielgeld. Es wird nie echtes Geld bewegt. Die Ergebnisse des Bots zeigen, was mit seiner Strategie passiert wäre – sie sind keine Empfehlung zum Kauf oder Verkauf.</p></section>';
  return head('Optionen', 'Aussehen anpassen und den Auto-Trader steuern.') + '<div class="grid-even"><div class="stack">' + design + data + '</div><div class="stack">' + bot + ghCard + about + '</div></div>';
}

/* ---------------- Detail ---------------- */
function openDetail(id) {
  if (!Q(id)) return;
  S.detail = id; S.detailMode = Q(id).fc ? 'f' : 'h'; S.trade = { side: 'buy', amt: '' };
  loadDaily(id);
  renderSheet();
  document.getElementById('sheet').classList.add('open'); document.getElementById('sheet-bg').classList.add('open');
  setTimeout(function () { var x = document.querySelector('#sheet .x'); if (x) x.focus(); }, 50);
}
function closeDetail() {
  S.detail = null;
  document.getElementById('sheet').classList.remove('open'); document.getElementById('sheet-bg').classList.remove('open');
}
function loadDaily(id) {
  var q = Q(id); if (!q || !S.db) return;
  var sh = KW.dailyShard(id, q);
  if (S.dailyT[sh] && Date.now() - S.dailyT[sh] < 10 * MIN) return;
  S.dailyT[sh] = Date.now();
  S.db.doc('daily/' + sh).get().then(function (snap) { if (snap.exists) { S.daily[sh] = snap.data(); if (S.detail) renderSheet(); } }).catch(function () { S.dailyT[sh] = 0; });
}
function renderSheet() {
  var el = document.getElementById('sheet'), id = S.detail; if (!id) return;
  var q = Q(id); if (!q) { closeDetail(); return; }
  var fav = (S.prefs.fav || []).indexOf(id) > -1;
  var open = KW.isOpen(q.m, Date.now()), fresh = canTrade(q);
  var daily = (S.daily[KW.dailyShard(id, q)] || {}).d; daily = daily && daily[id];
  var dPts = daily ? daily.map(function (x) { return [x[0] * DAY + 12 * HOUR, x[1]]; }) : [];
  var hPts = (q.h || []).map(function (x) { return [x[0] * MIN, x[1]]; });
  var mode = S.detailMode, pts = mode === 'd' ? dPts : hPts;
  var fcBox = '';
  if (mode === 'f') {
    var fc = q.fc, Hh = S.fcH || 20;
    if (!fc) { mode = 'h'; pts = hPts; }
    else if (dPts.length < 10) {
      fcBox = '<div class="empty-chart" style="height:200px"><div>Lade Kursgeschichte für die Prognose …</div></div>';
    } else {
      var fut = fcPath(q, fc, Hh), end = fut[fut.length - 1], chg = (end.mid / q.p - 1) * 100;
      var pu = Hh === 20 ? fc.pu : (function () { var z = (fc.mu * Hh) / (fc.s * Math.sqrt(Hh)); var t = 1 / (1 + 0.2316419 * Math.abs(z)), dd = 0.3989423 * Math.exp(-z * z / 2), pp = dd * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - pp : pp; })();
      var histPts = dPts.slice(-Math.max(40, Hh * 3));
      if (histPts[histPts.length - 1][0] < Date.now() - DAY) histPts.push([Date.now(), q.p]); else histPts[histPts.length - 1] = [Date.now(), q.p];
      var ev = S.meta && S.meta.fcEval;
      var reasons = (fc.why || []).map(function (w) { return '<li class="' + (w[0] === '+' ? 'up' : w[0] === '-' ? 'down' : 'muted') + '"><span>' + (w[0] === '+' ? '▲' : w[0] === '-' ? '▼' : '●') + '</span>' + esc(w[1]) + '</li>'; }).join('');
      fcBox = chartBox(histPts, { h: 240, fut: fut, q: q }) +
        '<div class="fc-sum"><div><span>In ' + (q.m === 'cr' ? Hh + ' Tagen' : Hh + ' Handelstagen') + ' (' + esc(tDM(end.t)) + ')</span><b class="num ' + cls(chg) + '">' + esc(price(end.mid, q.c)) + ' <small>' + pct(chg, 1) + '</small></b></div>' +
        '<div><span>Wahrscheinliche Spanne (80 %)</span><b class="num">' + esc(price(end.lo8, q.c)) + ' – ' + esc(price(end.hi8, q.c)) + '</b></div>' +
        '<div><span>Chance auf Plus</span><b class="num ' + (pu >= 0.5 ? 'up' : 'down') + '">' + Math.round(pu * 100) + ' %</b></div></div>' +
        '<div class="fc-meter" aria-hidden="true"><i style="width:' + Math.round(pu * 100) + '%"></i></div>' +
        '<ul class="fc-why">' + (reasons || '<li class="muted"><span>●</span>Keine besonderen Auffälligkeiten – die Prognose folgt dem normalen Verlauf.</li>') + '</ul>' +
        '<p class="note" style="margin:6px 0 0">So entsteht sie: Das Modell kombiniert Trend, Übertreibungen, Marktumfeld und die Einschätzung des lernenden Bots und rechnet daraus einen Korridor. Die dunkle Fläche zeigt, wo der Kurs mit 50 % Wahrscheinlichkeit landet, die helle mit 80 %.' +
        (ev && ev.n ? ' Rückblick über ' + nf(0).format(ev.n) + ' Tests: Richtung in ' + Math.round(ev.dir * 100) + ' % richtig, ' + Math.round(ev.cover * 100) + ' % lagen im 80-%-Korridor.' : '') + ' Keine Garantie und keine Anlageberatung.</p>';
    }
  }
  var chart = mode === 'f' && fcBox ? fcBox : pts.length >= 2 ? chartBox(pts, { h: 200, label: 'Kursverlauf ' + q.n, axisW: 60, fmtY: function (v) { return nf(v >= 100 ? 0 : pxDec(v)).format(v); }, fmtTip: function (v) { return price(v, q.c); } })
    : '<div class="empty-chart" style="height:160px"><div>Der Verlauf füllt sich mit jeder Aktualisierung.<br><span class="note">Bisher ' + pts.length + ' Datenpunkt' + (pts.length === 1 ? '' : 'e') + '.</span></div></div>';
  var bp = S.bot && S.bot.pos[id], mp = S.manual && S.manual.pos && S.manual.pos[id];
  var botBox = '';
  if (bp) {
    var bv = bp.q * q.p * KW.fxToEur(bp.c, fx()), bpl = bv - bp.cost;
    botBox = '<div class="summary"><div><b>Der Bot hält diesen Wert</b><span class="strat ' + bp.st + '">' + STRAT[bp.st] + '</span></div><div><span class="muted">Menge</span><span class="num">' + qtyFmt(bp.q, q.m) + ' · ' + eur(bv, 0) + '</span></div><div><span class="muted">Ergebnis</span><span class="num ' + cls(bpl) + '">' + eurS(bpl, 0) + ' (' + pct(bpl / bp.cost * 100) + ')</span></div><div><span class="muted">Grund</span><span style="text-align:right">' + esc(bp.r) + '</span></div></div>';
  }
  var trade = S.isOwner ? '<div id="trade-box"></div>' : '';
  var usd = q.c === 'USD';
  el.innerHTML = '<div class="sheet-top"><button class="x" data-close="1" aria-label="Schließen">' + I.x + '</button></div><div class="sheet-body">' +
    '<div><div class="chips" style="margin-bottom:8px"><span class="tk">' + esc(q.s) + '</span><span class="pill"><span class="dot ' + (q.m === 'cr' || open ? 'live' : 'off') + '"></span>' + (q.m === 'cr' ? 'Handel rund um die Uhr' : open ? 'Börse offen' : 'Börse geschlossen') + '</span>' +
    '<button class="btn" style="padding:6px 10px" data-fav="' + esc(id) + '" aria-pressed="' + fav + '" aria-label="Merken">' + (fav ? I.starOn : I.star) + '</button></div>' +
    '<h2 style="font-size:1.4rem">' + esc(q.n) + '</h2><div class="muted">' + MK[q.m] + (q.sec && q.sec !== 'Sonstige' ? ' · ' + esc(q.sec) : '') + '</div></div>' +
    '<div><div class="d-price num">' + price(q.p, q.c) + '</div><div class="chips"><span class="pill ' + cls(q.ch) + '">' + pct(q.ch) + ' ' + (q.m === 'cr' ? 'in 24 h' : 'heute') + '</span>' + (usd ? '<span class="pill"><span class="lbl">in Euro</span>' + eur(pe(q), pxDec(pe(q))) + '</span>' : '') + '</div></div>' +
    '<div><div class="card-head" style="margin-bottom:8px"><span class="eyebrow">' + (mode === 'f' ? 'KI-Prognose' : 'Kursverlauf') + '</span><div class="seg" role="group">' + (q.fc ? '<button data-dmode="f" aria-pressed="' + (mode === 'f') + '">KI-Prognose</button>' : '') + '<button data-dmode="h" aria-pressed="' + (mode === 'h') + '">Letzte Tage</button><button data-dmode="d" aria-pressed="' + (mode === 'd') + '">1 Jahr</button></div></div>' + (mode === 'f' ? '<div class="seg fc-h" role="group" style="margin:-2px 0 10px"><button data-fch="5" aria-pressed="' + ((S.fcH || 20) === 5) + '">1 Woche</button><button data-fch="10" aria-pressed="' + ((S.fcH || 20) === 10) + '">2 Wochen</button><button data-fch="20" aria-pressed="' + ((S.fcH || 20) === 20) + '">1 Monat</button></div>' : '') + '' + chart + '</div>' +
    '<div class="facts"><div><span>Kursstand</span><b class="num">' + esc(q.m === 'cr' ? whenShort(q.t) : tDMHM(q.t)) + '</b></div><div><span>Währung</span><b>' + (usd ? 'US-Dollar' : 'Euro') + '</b></div>' +
    '<div><span>Geschätzte Schwankung pro Tag</span><b class="num">± ' + nf(1).format(KW.indicators(q).dayVol) + ' %</b></div><div><span>' + (q.mc ? 'Marktwert' : 'Datenpunkte') + '</span><b class="num">' + (q.mc ? nf(0).format(q.mc / 1e9) + ' Mrd. $' : (q.h || []).length) + '</b></div></div>' +
    botBox + trade + '</div>';
  drawCharts(el);
  renderTrade();
}

function renderTrade() {
  var box = document.getElementById('trade-box'), id = S.detail, q = Q(id);
  if (!box || !q) return;
  var mp = S.manual && S.manual.pos && S.manual.pos[id], fresh = canTrade(q);
  var trade = '';
  {
    var m = S.manual || newManual(), side = S.trade.side;
    var pxE = pe(q), amt = parseAmt(S.trade.amt, S.trade.side);
    var qty = 0, val = 0, fee = 0, err = '';
    if (side === 'buy') {
      if (amt > 0) { qty = q.m === 'cr' ? Math.floor(amt / pxE * 1e6) / 1e6 : Math.floor(amt / pxE); val = qty * pxE; fee = qty > 0 ? KW.fee(val, feePct()) : 0; }
      if (amt > 0 && qty <= 0) err = 'Der Betrag reicht nicht für ein ganzes Stück (' + eur(pxE) + ').';
      else if (val + fee > m.cash + 0.005) err = 'Nicht genug Bargeld (' + eur(m.cash) + ').';
    } else {
      var have = mp ? mp.q : 0;
      qty = amt > 0 ? (q.m === 'cr' ? Math.min(have, amt) : Math.min(have, Math.floor(amt))) : 0;
      val = qty * pxE; fee = qty > 0 ? KW.fee(val, feePct()) : 0;
      if (!have) err = 'Du besitzt diesen Wert nicht.';
    }
    if (!fresh) err = q.m === 'cr' ? 'Der Kurs ist gerade nicht aktuell genug zum Handeln.' : (MK[q.m] + ': Börse geschlossen. Handeln geht zu den Handelszeiten (' + (q.m === 'de' ? 'Mo–Fr 9:00–17:35' : 'Mo–Fr 15:30–22:00') + ' Uhr).');
    var ok = !err && qty > 0;
    var quick = side === 'buy' ? [1000, 5000, 10000, 25000].map(function (v) { return '<button data-amt="' + v + '">' + nf(0).format(v) + ' €</button>'; }).join('') + '<button data-amt="max">Max</button>'
      : (mp ? '<button data-amt="' + (q.m === 'cr' ? mp.q / 2 : Math.floor(mp.q / 2)) + '">Hälfte</button><button data-amt="' + mp.q + '">Alles (' + qtyFmt(mp.q, q.m) + ')</button>' : '');
    trade = '<div class="card" style="padding:16px"><div class="card-head" style="margin-bottom:10px"><h2>Selbst handeln</h2><div class="seg" role="group"><button data-side="buy" aria-pressed="' + (side === 'buy') + '">Kaufen</button><button data-side="sell" aria-pressed="' + (side === 'sell') + '">Verkaufen</button></div></div>' +
      '<div class="field"><label for="t-amt">' + (side === 'buy' ? 'Betrag in Euro' : 'Anzahl Stück') + '</label><input class="inp num" id="t-amt" inputmode="decimal" placeholder="' + (side === 'buy' ? 'z. B. 2.500' : 'z. B. 10') + '" value="' + esc(S.trade.amt) + '"></div>' +
      '<div class="qchips" style="margin-top:8px">' + quick + '</div>' +
      '<div class="summary" style="margin-top:12px"><div><span class="muted">Stück</span><span class="num">' + (qty ? qtyFmt(qty, q.m) : '–') + '</span></div><div><span class="muted">Kurs (in Euro)</span><span class="num">' + eur(pxE, pxDec(pxE)) + '</span></div><div><span class="muted">Gebühr</span><span class="num">' + (fee ? eur(fee) : '–') + '</span></div><div><b>' + (side === 'buy' ? 'Kosten gesamt' : 'Du erhältst') + '</b><b class="num">' + (qty ? eur(side === 'buy' ? val + fee : val - fee) : '–') + '</b></div></div>' +
      (err && (amt > 0 || !fresh || side === 'sell') ? '<p class="note ' + (fresh ? 'err' : 'warn') + '" style="margin:10px 0 0">' + esc(err) + '</p>' : '') +
      '<button class="btn ' + (side === 'buy' ? 'buy' : 'sell') + ' full" style="margin-top:12px" data-act="trade"' + (ok ? '' : ' disabled') + '>' + (side === 'buy' ? 'Mit Spielgeld kaufen' : 'Verkaufen') + '</button>' +
      '<p class="note" style="margin:8px 0 0">Verfügbar: ' + eur(m.cash) + (mp ? ' · Im Depot: ' + qtyFmt(mp.q, q.m) + ' Stück' : '') + '</p></div>';
  }
  box.innerHTML = trade.replace(/^<div class="card" style="padding:16px">/, '<div class="card" style="padding:16px">');
}

/* ---------------- Rendern ---------------- */
var rq = null;
function render() { if (rq) return; rq = requestAnimationFrame(function () { rq = null; doRender(); }); }
var lastView = null;
function doRender() {
  renderChrome();
  var v = document.getElementById('view');
  var active = document.activeElement, keepSearch = active && active.id === 'q-search', selStart = keepSearch ? active.selectionStart : 0;
  CH = {};
  var html = S.view === 'maerkte' ? vMarkets() : S.view === 'analyse' ? vAnalyse() : S.view === 'depot' ? vDepot() : S.view === 'optionen' ? vOptions() : vStart();
  var sameView = lastView === S.view;
  v.innerHTML = html;
  if (sameView) v.querySelectorAll(':scope > *').forEach(function (c) { c.style.animation = 'none'; });
  lastView = S.view;
  if (S.view === 'maerkte') renderList();
  drawCharts(v);
  countUp(v);
  if (keepSearch) { var s = document.getElementById('q-search'); if (s) { s.focus(); try { s.setSelectionRange(selStart, selStart); } catch (e) { /* egal */ } } }
  if (S.detail) renderSheet();
}
function countUp(root) {
  var el = root.querySelector('[data-count]'); if (!el) return;
  var to = parseFloat(el.getAttribute('data-count')), from = S.shownEq == null ? to * 0.985 : S.shownEq;
  S.shownEq = to;
  if (S.prefs.motion === false || from === to || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var t0 = performance.now(), dur = 900;
  function fmt(x) { var e = Math.floor(Math.abs(x)), c = Math.round((Math.abs(x) - e) * 100); if (c === 100) { e++; c = 0; } return nf(0).format(e) + '<span class="cents">,' + String(c).padStart(2, '0') + ' €</span>'; }
  (function step(now) {
    var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.innerHTML = fmt(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}
function toast(msg) {
  var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2800);
}

/* ---------------- Aktionen ---------------- */
function savePrefs(patch) {
  S.prefs = Object.assign({}, S.prefs, patch);
  saveLocalPrefs(S.prefs); applyPrefs(); render();
  if (S.db && S.isOwner) { clearTimeout(savePrefs._t); savePrefs._t = setTimeout(function () { S.db.doc('prefs/ui').set(S.prefs).catch(function () { toast('Einstellung gespeichert, aber nicht an GitHub übertragen.'); }); }, 500); }
}
var writing = false;
function saveSettings(patch, msg) {
  if (!S.db || !S.isOwner || writing) return;
  var next = Object.assign(KW.defaultSettings(), S.settings || {}, patch);
  S.settings = next; render(); writing = true;
  S.db.doc('bot/settings').set(next).then(function () { toast(msg || 'Gespeichert. Gilt ab der nächsten Runde.'); })
    .catch(function () { toast('Hier gespeichert, aber GitHub hat es nicht angenommen. Schlüssel prüfen.'); }).then(function () { writing = false; });
}
function doTrade() {
  var id = S.detail, q = Q(id); if (!q || !S.db || !S.isOwner || S.busy) return;
  if (!canTrade(q)) { toast('Die Börse ist gerade geschlossen.'); return; }
  var m = JSON.parse(JSON.stringify(S.manual || newManual()));
  var pxE = pe(q), amt = parseAmt(S.trade.amt, S.trade.side);
  if (!(amt > 0)) return;
  var fp = feePct(), now = Date.now();
  if (S.trade.side === 'buy') {
    var qty = q.m === 'cr' ? Math.floor(amt / pxE * 1e6) / 1e6 : Math.floor(amt / pxE);
    var val = qty * pxE, fee = KW.fee(val, fp);
    if (qty <= 0 || val + fee > m.cash + 0.005) { toast('Nicht genug Bargeld.'); return; }
    m.cash = +(m.cash - val - fee).toFixed(2);
    var p = m.pos[id];
    if (p) { var nq = p.q + qty; p.p0 = (p.p0 * p.q + q.p * qty) / nq; p.q = q.m === 'cr' ? +nq.toFixed(6) : nq; p.cost = +(p.cost + val + fee).toFixed(2); }
    else m.pos[id] = { q: qty, p0: q.p, c: q.c, cost: +(val + fee).toFixed(2), t0: now, m: q.m };
    m.trades.push({ i: id, n: q.n, s: 'K', q: qty, p: q.p, c: q.c, v: +val.toFixed(2), f: fee, t: now, m: q.m });
    var msg = 'Gekauft: ' + qtyFmt(qty, q.m) + ' × ' + q.n;
  } else {
    var pp = m.pos[id]; if (!pp) return;
    var sq = q.m === 'cr' ? Math.min(pp.q, amt) : Math.min(pp.q, Math.floor(amt));
    if (sq <= 0) return;
    var sv = sq * pxE, sf = KW.fee(sv, fp), part = pp.cost * (sq / pp.q), pl = sv - sf - part;
    m.cash = +(m.cash + sv - sf).toFixed(2);
    pp.cost = +(pp.cost - part).toFixed(2); pp.q = q.m === 'cr' ? +(pp.q - sq).toFixed(6) : pp.q - sq;
    if (pp.q <= 0) delete m.pos[id];
    m.trades.push({ i: id, n: q.n, s: 'V', q: sq, p: q.p, c: q.c, v: +sv.toFixed(2), f: sf, t: now, m: q.m, pl: +pl.toFixed(2) });
    msg = 'Verkauft: ' + qtyFmt(sq, q.m) + ' × ' + q.n + ' (' + eurS(pl) + ')';
  }
  if (m.trades.length > 300) m.trades.splice(0, m.trades.length - 300);
  S.busy = true; S.manual = m; S.trade.amt = ''; render();
  S.db.doc('manual/state').set(m).then(function () { toast(msg); }).catch(function () { toast('Order konnte nicht gespeichert werden.'); }).then(function () { S.busy = false; });
}
function doRefresh() {
  var F = window.KWFREE; if (!F || !F.connected()) { toast('Verbinde zuerst GitHub unter Optionen.'); return; }
  savePrefs({ lastRefresh: Date.now() });
  F.refresh().then(function () { toast('Neue Runde gestartet. Ergebnisse in 1–3 Minuten.'); })
    .catch(function () { toast('Start hat nicht geklappt. Prüfe, ob der Schlüssel „Actions“ schreiben darf.'); });
}
function ghSave(clear) {
  var F = window.KWFREE; if (!F) return;
  var repo = clear ? '' : (document.getElementById('gh-repo') || {}).value, token = clear ? '' : (document.getElementById('gh-token') || {}).value;
  F.save(clear ? F.cfg.repo : repo, token).then(function (ok) {
    toast(clear ? 'Getrennt. Änderungen gelten nur noch auf diesem Gerät.' : ok ? 'Verbunden. Änderungen werden jetzt mit allen Geräten geteilt.' : 'Gespeichert, aber GitHub hat den Schlüssel nicht akzeptiert. Bitte prüfen.');
    render();
    if (!clear && ok) { if (S.settings) S.db.doc('bot/settings').set(S.settings); }
  });
}
document.addEventListener('click', function (e) {
  var t = e.target.closest('button, a, [data-open], tr[data-open]'); if (!t) return;
  var d = t.dataset;
  if (d.close) return closeDetail();
  if (d.range) { S.range = d.range; return render(); }
  if (d.mk) { S.f.mk = d.mk; S.f.limit = 60; return render(); }
  if (d.more) { S.f.limit += 60; return renderList(); }
  if (d.ana) { S.ana = d.ana; return render(); }
  if (d.pref) { var v = d.val === 'true' ? true : d.val === 'false' ? false : d.val; var o = {}; o[d.pref] = v; return savePrefs(o); }
  if (d.toggle) { var o2 = {}; o2[d.toggle] = d.toggle === 'motion' ? S.prefs.motion === false : !S.prefs[d.toggle]; return savePrefs(o2); }
  if (d.bot) {
    var st = Object.assign(KW.defaultSettings(), S.settings || {});
    if (d.bot === 'enabled') return saveSettings({ enabled: !(st.enabled !== false) }, st.enabled !== false ? 'Auto-Trader pausiert.' : 'Auto-Trader läuft wieder.');
    if (d.bot === 'risk') return saveSettings({ risk: d.val });
    if (d.bot === 'fee') return saveSettings({ feePct: +d.val });
    if (d.bot === 'invest') return saveSettings({ invest: +d.val }, +d.val >= 1 ? 'Der Bot setzt ab der nächsten Runde das komplette Kapital ein.' : 'Gespeichert. Gilt ab der nächsten Runde.');
    if (d.bot === 'capital') return saveSettings({ capital: +d.val }, 'Gespeichert. Gilt ab dem nächsten Neustart des Auto-Traders.');
    if (d.bot === 'market') { var mk = Object.assign({ us: true, de: true, cr: true }, st.markets || {}); mk[d.val] = !mk[d.val]; if (!mk.us && !mk.de && !mk.cr) { toast('Mindestens ein Markt muss aktiv bleiben.'); return; } return saveSettings({ markets: mk }); }
  }
  if (d.ask) { S.confirm = d.ask; return render(); }
  if (d.cancel) { S.confirm = null; return render(); }
  if (d.act === 'reset-bot') { S.confirm = null; return saveSettings({ resetAt: Date.now(), enabled: true }, 'Neustart vorgemerkt.'); }
  if (d.act === 'reset-manual') { S.confirm = null; if (!S.db) return; var nm = newManual(); S.manual = nm; render(); S.db.doc('manual/state').set(nm).then(function () { toast('Depot zurückgesetzt.'); }).catch(function () { toast('Zurücksetzen hat nicht geklappt.'); }); return; }
  if (d.act === 'refresh') return doRefresh();
  if (d.act === 'gh-save') return ghSave(false);
  if (d.act === 'gh-clear') return ghSave(true);
  if (d.act === 'trade') return doTrade();
  if (d.side) { S.trade.side = d.side; S.trade.amt = ''; return renderTrade(); }
  if (d.amt) {
    if (d.amt === 'max') { var mm = S.manual || newManual(); S.trade.amt = String(Math.max(0, Math.floor((mm.cash - 1) / (1 + feePct() / 100)))); }
    else S.trade.amt = String(+d.amt).replace('.', ',');
    return renderTrade();
  }
  if (d.dmode) { S.detailMode = d.dmode; return renderSheet(); }
  if (d.fch) { S.fcH = +d.fch; return renderSheet(); }
  if (d.fav) { var f = (S.prefs.fav || []).slice(), i = f.indexOf(d.fav); if (i > -1) f.splice(i, 1); else f.push(d.fav); savePrefs({ fav: f }); toast(i > -1 ? 'Von der Merkliste entfernt.' : 'Auf die Merkliste gesetzt.'); return; }
  if (d.open) { e.preventDefault(); return openDetail(d.open); }
});
document.getElementById('sheet-bg').addEventListener('click', closeDetail);
document.addEventListener('keydown', function (e) {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('[data-open]:not(button)')) { e.preventDefault(); openDetail(e.target.getAttribute('data-open')); }
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.detail) closeDetail(); });
document.addEventListener('input', function (e) {
  if (e.target.id === 'q-search') { S.f.q = e.target.value; S.f.limit = 60; renderList(); }
  if (e.target.id === 't-amt') {
    S.trade.amt = e.target.value;
    var pos = e.target.selectionStart; renderTrade();
    var n = document.getElementById('t-amt'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (er) { /* egal */ } }
  }
});
document.addEventListener('change', function (e) { if (e.target.id === 'q-sort') { S.f.sort = e.target.value; renderList(); } });

/* ---------------- Navigation ---------------- */
function route() {
  var h = (location.hash || '').replace('#', '');
  var v = VIEWS.some(function (x) { return x[0] === h; }) ? h : 'start';
  if (v !== S.view) { S.view = v; S.confirm = null; window.scrollTo(0, 0); }
  render();
}
window.addEventListener('hashchange', route);

/* ---------------- Datenanbindung ---------------- */
function joinNow() { if (S.meta || Object.keys(S.shards).length) S.market = KW.joinMarket(S.meta, S.shards); }
function sub(path, onData) {
  return S.db.doc(path).onSnapshot(function (snap) {
    S.got[path] = true; onData(snap.exists ? snap.data() : null, snap); render();
  }, function () { S.got[path] = true; render(); });
}
function connect() {
  var F = window.KWFREE;
  if (!F) { S.dbState = 'none'; render(); return; }
  S.db = F.db; S.isOwner = true; S.dbState = 'loading';
  var slowT = setTimeout(function () { if (!S.meta && S.dbState === 'loading') { S.dbState = 'none'; render(); } }, 8000);
  sub('market/meta', function (d) { S.meta = d; if (d) { S.dbState = 'ok'; clearTimeout(slowT); } joinNow(); });
  KW.QUOTE_SHARDS.forEach(function (s2) { sub('quotes/' + s2, function (d) { if (d) S.shards[s2] = d; else delete S.shards[s2]; joinNow(); }); });
  sub('bot/state', function (d) { S.bot = d; });
  sub('bot/settings', function (d) { S.settings = d; });
  sub('manual/state', function (d) { S.manual = d; S.got.manual = true; });
  sub('config/app', function (d) { S.config = d; });
  sub('prefs/ui', function (d) {
    if (d && typeof d === 'object') { var p = Object.assign({}, d); delete p._u; S.prefs = Object.assign({}, DEFAULT_PREFS, p); saveLocalPrefs(S.prefs); applyPrefs(); }
  });
}
setInterval(function () { renderChrome(); }, 30000);
route();
connect();
})();

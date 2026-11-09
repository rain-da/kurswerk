// Kurswerk – kostenlose Bot-Runde für GitHub Actions.
// Holt echte Kurse (Yahoo Finance, CoinGecko), lässt den Auto-Trader handeln und schreibt die Daten für die App.
// Aufruf: node bot/run.mjs   (Umgebungsvariablen: STATE_IN, OUT_DIR, USER_DIR)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KW = require(path.join(ROOT, 'engine.js'));

const STATE_IN = process.env.STATE_IN && fs.existsSync(path.join(process.env.STATE_IN, 'bot_state.json')) ? process.env.STATE_IN : path.join(ROOT, 'data');
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, 'data');
const USER_DIR = process.env.USER_DIR || path.join(ROOT, 'user');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const now = Date.now();
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

function readJson(dir, name) { try { return JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8')); } catch { return null; } }
function writeJson(dir, name, obj) {
  const body = JSON.stringify(obj);
  if (body.length > 4_000_000) throw new Error('Datei zu groß: ' + name);
  fs.writeFileSync(path.join(dir, name + '.json'), body);
}
async function getText(url, opt = {}, timeoutMs = 20000) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opt, signal: ctl.signal, headers: { 'User-Agent': UA, Accept: '*/*', ...(opt.headers || {}) } });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, txt, headers: r.headers };
  } finally { clearTimeout(t); }
}
async function getJson(url, opt) { const r = await getText(url, opt); if (!r.ok) throw new Error(url.split('?')[0] + ' → HTTP ' + r.status); return JSON.parse(r.txt); }
async function pool(items, n, fn) { const out = []; let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } } })); return out; }

/* ---------- Werte, die beobachtet werden ---------- */
const universe = []; // {id, ysym, n, s, m, c, sec}
{
  const seen = new Set();
  for (const [ticker, name, sec] of Object.values(KW.US)) {
    if (seen.has(ticker)) continue; seen.add(ticker);
    universe.push({ id: ticker, ysym: ticker.replace('.', '-'), n: name, s: ticker, m: 'us', c: 'USD', sec });
  }
  const seenDe = new Set();
  for (const [ticker, name, sec] of Object.values(KW.DE)) {
    if (seenDe.has(ticker)) continue; seenDe.add(ticker);
    universe.push({ id: ticker + '.DE', ysym: ticker + '.DE', n: name, s: ticker, m: 'de', c: 'EUR', sec });
  }
}
const MACRO = { '^GDAXI': ['DAX', 'DAX'], '^GSPC': ['SPX', 'S&P 500'], '^NDX': ['NDX', 'Nasdaq 100'], '^DJI': ['DJI', 'Dow Jones'],
  '^STOXX50E': ['SX5E', 'Euro Stoxx 50'], '^SSMI': ['SMI', 'SMI'], 'GC=F': ['GOLD', 'Gold'], 'BZ=F': ['OIL', 'Öl (Brent)'], 'EURUSD=X': ['EURUSD', 'EUR/USD'] };
const CRYPTO_FALLBACK = ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX', 'ADA', 'LINK', 'AVAX', 'XLM', 'LTC', 'BCH', 'DOT', 'SUI', 'HBAR', 'XMR', 'ZEC'];

/* ---------- Yahoo Finance ---------- */
async function yahooSession() {
  try {
    const r = await getText('https://fc.yahoo.com/', { redirect: 'manual' });
    const cookies = (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''])
      .map((c) => c.split(';')[0]).filter(Boolean).join('; ');
    if (!cookies) return null;
    const c = await getText('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { cookie: cookies } });
    if (!c.ok || !c.txt || c.txt.length > 40 || /</.test(c.txt)) return null;
    return { cookie: cookies, crumb: c.txt.trim() };
  } catch { return null; }
}
async function yahooQuoteBatch(symbols, sess) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 120) {
    const chunk = symbols.slice(i, i + 120);
    const url = 'https://query2.finance.yahoo.com/v7/finance/quote?symbols=' + encodeURIComponent(chunk.join(',')) + '&crumb=' + encodeURIComponent(sess.crumb);
    try {
      const j = await getJson(url, { headers: { cookie: sess.cookie } });
      for (const q of (j.quoteResponse && j.quoteResponse.result) || []) {
        if (!(q.regularMarketPrice > 0)) continue;
        out[q.symbol] = { p: q.regularMarketPrice, ch: q.regularMarketChangePercent, t: (q.regularMarketTime || 0) * 1000, name: q.shortName || q.longName };
      }
    } catch (e) { say('Yahoo-Sammelabfrage:', e.message); }
  }
  return out;
}
async function yahooChart(sym) {
  const j = await getJson('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?range=1d&interval=15m');
  const m = j.chart && j.chart.result && j.chart.result[0] && j.chart.result[0].meta;
  if (!m || !(m.regularMarketPrice > 0)) return null;
  const prev = m.chartPreviousClose || m.previousClose;
  return { p: m.regularMarketPrice, ch: prev ? (m.regularMarketPrice / prev - 1) * 100 : NaN, t: (m.regularMarketTime || 0) * 1000, name: m.shortName };
}
async function fetchStocks() {
  const syms = universe.map((u) => u.ysym).concat(Object.keys(MACRO));
  let res = {};
  const sess = await yahooSession();
  if (sess) res = await yahooQuoteBatch(syms, sess);
  say('Yahoo Sammelabfrage:', Object.keys(res).length, 'von', syms.length, sess ? '' : '(keine Sitzung)');
  const missing = syms.filter((s) => !res[s]);
  if (missing.length) {
    const got = await pool(missing, 6, yahooChart);
    let n = 0; missing.forEach((s, i) => { if (got[i]) { res[s] = got[i]; n++; } });
    say('Yahoo Einzelabfragen:', n, 'von', missing.length);
  }
  return res;
}

/* ---------- Krypto ---------- */
async function fetchCrypto(yahooRes) {
  const out = [];
  try {
    const j = await getJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=40&page=1&price_change_percentage=24h,7d');
    for (const c of j) {
      const sym = String(c.symbol || '').toUpperCase();
      if (!sym || KW.CRYPTO_SKIP[sym] || /usd|stable|wrapped|staked|bridged|tether gold/i.test(c.name || '') || !(c.current_price > 0)) continue;
      out.push({ id: sym + '.X', n: KW.CRYPTO_NAMES[sym] || c.name, s: sym, m: 'cr', c: 'USD', sec: 'Krypto', p: c.current_price,
        ch: c.price_change_percentage_24h, t: Date.parse(c.last_updated) || now, mc: c.market_cap });
      if (out.length >= 25) break;
    }
    say('CoinGecko:', out.length, 'Coins');
  } catch (e) { say('CoinGecko:', e.message); }
  if (out.length < 5) {
    const syms = CRYPTO_FALLBACK.map((s) => s + '-USD');
    const got = await pool(syms, 6, yahooChart);
    syms.forEach((s, i) => { const g = got[i]; if (g) out.push({ id: CRYPTO_FALLBACK[i] + '.X', n: KW.CRYPTO_NAMES[CRYPTO_FALLBACK[i]] || CRYPTO_FALLBACK[i], s: CRYPTO_FALLBACK[i], m: 'cr', c: 'USD', sec: 'Krypto', p: g.p, ch: g.ch, t: g.t || now }); });
    say('Krypto über Yahoo:', out.length);
  }
  return out;
}

/* ---------- Ablauf ---------- */
async function main() {
  // vorheriger Stand
  const meta = readJson(STATE_IN, 'market_meta');
  const shards = {}; KW.QUOTE_SHARDS.forEach((s) => { shards[s] = readJson(STATE_IN, 'quotes_' + s); });
  const daily = {}; KW.DAILY_SHARDS.forEach((s) => { const d = readJson(STATE_IN, 'daily_' + s); if (d) daily[s] = d; });
  const state = readJson(STATE_IN, 'bot_state');
  const settings = readJson(USER_DIR, 'bot_settings') || KW.defaultSettings();
  const market = KW.joinMarket(meta, shards);

  // neue Kurse
  const ys = await fetchStocks();
  const quotes = [];
  for (const u of universe) {
    const r = ys[u.ysym]; if (!r) continue;
    quotes.push({ id: u.id, n: u.n, s: u.s, m: u.m, c: u.c, sec: u.sec, p: r.p, ch: r.ch, t: r.t || now });
  }
  quotes.push(...await fetchCrypto(ys));
  const macro = {};
  for (const [sym, [key, name]] of Object.entries(MACRO)) { const r = ys[sym]; if (r && key !== 'EURUSD') macro[key] = { n: name, v: +r.p.toFixed(r.p < 100 ? 2 : 0), ch: r.ch }; }
  const eurusd = ys['EURUSD=X'] && ys['EURUSD=X'].p;
  if (eurusd) macro.EURUSD = { n: 'EUR/USD', v: +eurusd.toFixed(4), ch: ys['EURUSD=X'].ch };

  const ing = KW.ingestQuotes(market, { quotes, macro, eurusd }, now);
  // Alte Einträge entfernen, die nicht mehr beobachtet werden (außer der Bot hält sie)
  const held = new Set(Object.keys((state && state.pos) || {}));
  for (const id of Object.keys(ing.market.q)) {
    const q = ing.market.q[id];
    if (!held.has(id) && now - (q.t || 0) > 3 * 86400000) delete ing.market.q[id];
  }
  const res = KW.runBot(state, settings, ing.market, now);
  ing.market.botEq = +res.equity.toFixed(2);
  ing.market.src = 'Yahoo Finance, CoinGecko';
  KW.updateDaily(daily, ing.market, ing.changed);
  for (const s of Object.keys(daily)) for (const id of Object.keys(daily[s].d || {})) if (!ing.market.q[id]) delete daily[s].d[id];

  // schreiben
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const sp = KW.splitMarket(ing.market);
  writeJson(OUT_DIR, 'market_meta', sp.meta);
  for (const s of KW.QUOTE_SHARDS) writeJson(OUT_DIR, 'quotes_' + s, sp.shards[s]);
  for (const s of KW.DAILY_SHARDS) writeJson(OUT_DIR, 'daily_' + s, daily[s] || { d: {} });
  writeJson(OUT_DIR, 'bot_state', res.bot);
  writeJson(OUT_DIR, 'config_app', { refreshWorkflow: 'bot.yml', updatedAt: now });

  say('Kurse aktualisiert:', JSON.stringify(ing.counts), '· EUR/USD', ing.market.fx.EURUSD);
  say('Depotwert:', Math.round(res.equity), '€ ·', Object.keys(res.bot.pos).length, 'Positionen');
  res.events.forEach((e) => say('•', e));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Kurswerk-Runde\n' + log.map((l) => '- ' + l).join('\n') + '\n');
  if (!quotes.length) { console.error('Keine Kurse erhalten – Daten bleiben unverändert gespeichert.'); }
}
main().catch((e) => { console.error('Fehler:', e && e.stack || e); process.exit(1); });

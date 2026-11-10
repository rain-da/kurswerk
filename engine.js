/* Kurswerk Engine v1 – Kursdaten einlesen + Auto-Trader (Paper Trading).
   Läuft im Browser (window.KW) und in Node (require). */
(function (root, factory) {
  var E = factory();
  if (typeof module === 'object' && module.exports) module.exports = E;
  else root.KW = E;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = 1;
  var TZ = 'Europe/Berlin';
  var START_CASH = 100000;
  var MIN = 60000, HOUR = 3600000, DAY = 86400000;

  /* ---------------- Zeit ---------------- */
  var _dtf = {};
  function partsIn(ms, tz) {
    tz = tz || TZ;
    if (!_dtf[tz]) _dtf[tz] = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, weekday: 'short'
    });
    var o = {};
    _dtf[tz].formatToParts(new Date(ms)).forEach(function (p) { o[p.type] = p.value; });
    var wdMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    var h = +o.hour; if (h === 24) h = 0;
    return { y: +o.year, mo: +o.month, d: +o.day, h: h, mi: +o.minute, s: +o.second, wd: wdMap[o.weekday] };
  }
  function zonedToUtc(y, mo, d, h, mi, s, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, s || 0);
    for (var i = 0; i < 3; i++) {
      var p = partsIn(guess, tz);
      var asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
      var diff = asUtc - Date.UTC(y, mo - 1, d, h, mi, s || 0);
      if (diff === 0) break;
      guess -= diff;
    }
    return guess;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(ms) { var p = partsIn(ms); return p.y + '-' + pad(p.mo) + '-' + pad(p.d); }

  /* Handelszeiten (ohne Feiertage – die Frische-Regel fängt geschlossene Tage ab) */
  function isOpen(m, ms) {
    if (m === 'cr') return true;
    if (m === 'de') {
      var p = partsIn(ms, TZ); if (p.wd === 0 || p.wd === 6) return false;
      var x = p.h * 60 + p.mi; return x >= 540 && x < 1055; // 9:00–17:35
    }
    if (m === 'us') {
      var q = partsIn(ms, 'America/New_York'); if (q.wd === 0 || q.wd === 6) return false;
      var y = q.h * 60 + q.mi; return y >= 570 && y < 960; // 9:30–16:00 NY
    }
    return false;
  }

  /* ---------------- Stammdaten ---------------- */
  // DAX 40: Wert = [Ticker, Anzeigename, Branche]
  var DE = {
    adidas: ['ADS', 'Adidas', 'Konsum'], airbus: ['AIR', 'Airbus', 'Industrie'], allianz: ['ALV', 'Allianz', 'Versicherung'],
    basf: ['BAS', 'BASF', 'Chemie'], bayer: ['BAYN', 'Bayer', 'Pharma'], beiersdorf: ['BEI', 'Beiersdorf', 'Konsum'],
    bmw: ['BMW', 'BMW', 'Auto'], brenntag: ['BNR', 'Brenntag', 'Chemie'], commerzbank: ['CBK', 'Commerzbank', 'Finanzen'],
    continental: ['CON', 'Continental', 'Auto'], daimlertruck: ['DTG', 'Daimler Truck', 'Auto'],
    deutschebank: ['DBK', 'Deutsche Bank', 'Finanzen'], deutscheboerse: ['DB1', 'Deutsche Börse', 'Finanzen'],
    deutschetelekom: ['DTE', 'Deutsche Telekom', 'Telekom'],
    dhl: ['DHL', 'DHL Group', 'Industrie'], eon: ['EOAN', 'E.ON', 'Versorger'],
    fresenius: ['FRE', 'Fresenius', 'Gesundheit'], freseniusmedicalcare: ['FME', 'Fresenius Medical Care', 'Gesundheit'],
    gea: ['G1A', 'GEA', 'Industrie'], hannover: ['HNR1', 'Hannover Rück', 'Versicherung'],
    heidelberg: ['HEI', 'Heidelberg Materials', 'Industrie'], henkel: ['HEN3', 'Henkel', 'Konsum'], hochtief: ['HOT', 'Hochtief', 'Industrie'],
    infineon: ['IFX', 'Infineon', 'Halbleiter'], mercedes: ['MBG', 'Mercedes-Benz', 'Auto'], merck: ['MRK', 'Merck KGaA', 'Pharma'],
    mtu: ['MTX', 'MTU Aero Engines', 'Industrie'], muenchener: ['MUV2', 'Munich Re', 'Versicherung'],
    qiagen: ['QIA', 'Qiagen', 'Gesundheit'], rheinmetall: ['RHM', 'Rheinmetall', 'Rüstung'], rwe: ['RWE', 'RWE', 'Versorger'],
    sap: ['SAP', 'SAP', 'Software'], scout24: ['G24', 'Scout24', 'Technologie'], siemens: ['SIE', 'Siemens', 'Industrie'],
    siemensenergy: ['ENR', 'Siemens Energy', 'Energie'], siemenshealthineers: ['SHL', 'Siemens Healthineers', 'Gesundheit'],
    symrise: ['SY1', 'Symrise', 'Chemie'], volkswagen: ['VOW3', 'Volkswagen', 'Auto'], vonovia: ['VNA', 'Vonovia', 'Immobilien'],
    zalando: ['ZAL', 'Zalando', 'Handel'], porsche: ['P911', 'Porsche', 'Auto']
  };
  var US = {
    adobe: ['ADBE', 'Adobe', 'Software'], airbnb: ['ABNB', 'Airbnb', 'Konsum'], alnylam: ['ALNY', 'Alnylam', 'Pharma'],
    alphabeta: ['GOOGL', 'Alphabet A', 'Technologie'], alphabetc: ['GOOG', 'Alphabet C', 'Technologie'],
    amazon: ['AMZN', 'Amazon', 'Handel'], amd: ['AMD', 'AMD', 'Halbleiter'],
    americanelectric: ['AEP', 'American Electric Power', 'Versorger'], amgen: ['AMGN', 'Amgen', 'Pharma'],
    analogdevices: ['ADI', 'Analog Devices', 'Halbleiter'], apple: ['AAPL', 'Apple', 'Technologie'],
    appliedmaterials: ['AMAT', 'Applied Materials', 'Halbleiter'], applovin: ['APP', 'AppLovin', 'Software'],
    arm: ['ARM', 'Arm Holdings', 'Halbleiter'], asml: ['ASML', 'ASML', 'Halbleiter'], asteralabs: ['ALAB', 'Astera Labs', 'Halbleiter'],
    atlassian: ['TEAM', 'Atlassian', 'Software'], autodesk: ['ADSK', 'Autodesk', 'Software'], automaticdata: ['ADP', 'ADP', 'Software'],
    axon: ['AXON', 'Axon', 'Industrie'], bakerhughes: ['BKR', 'Baker Hughes', 'Energie'], biogen: ['BIIB', 'Biogen', 'Pharma'],
    booking: ['BKNG', 'Booking', 'Konsum'], broadcom: ['AVGO', 'Broadcom', 'Halbleiter'], cadence: ['CDNS', 'Cadence', 'Software'],
    charter: ['CHTR', 'Charter', 'Medien'], cintas: ['CTAS', 'Cintas', 'Industrie'], cisco: ['CSCO', 'Cisco', 'Technologie'],
    cocacolaeuropean: ['CCEP', 'Coca-Cola Europacific', 'Konsum'], cognizant: ['CTSH', 'Cognizant', 'Software'],
    comcast: ['CMCSA', 'Comcast', 'Medien'], constellation: ['CEG', 'Constellation Energy', 'Versorger'], copart: ['CPRT', 'Copart', 'Handel'],
    coreweave: ['CRWV', 'CoreWeave', 'Technologie'], costco: ['COST', 'Costco', 'Handel'], crowdstrike: ['CRWD', 'CrowdStrike', 'Software'],
    csx: ['CSX', 'CSX', 'Industrie'], datadog: ['DDOG', 'Datadog', 'Software'], dexcom: ['DXCM', 'DexCom', 'Gesundheit'],
    diamondback: ['FANG', 'Diamondback Energy', 'Energie'], doordash: ['DASH', 'DoorDash', 'Konsum'], electronicarts: ['EA', 'Electronic Arts', 'Medien'],
    exelon: ['EXC', 'Exelon', 'Versorger'], fastenal: ['FAST', 'Fastenal', 'Handel'], ferrovial: ['FER', 'Ferrovial', 'Industrie'],
    fortinet: ['FTNT', 'Fortinet', 'Software'], gehealthcare: ['GEHC', 'GE HealthCare', 'Gesundheit'], gilead: ['GILD', 'Gilead', 'Pharma'],
    globalfoundries: ['GFS', 'GlobalFoundries', 'Halbleiter'], honeywell: ['HON', 'Honeywell', 'Industrie'], idexx: ['IDXX', 'IDEXX', 'Gesundheit'],
    intel: ['INTC', 'Intel', 'Halbleiter'], intuitivesurgical: ['ISRG', 'Intuitive Surgical', 'Gesundheit'], intuit: ['INTU', 'Intuit', 'Software'],
    insmed: ['INSM', 'Insmed', 'Pharma'], keurig: ['KDP', 'Keurig Dr Pepper', 'Konsum'], kla: ['KLAC', 'KLA', 'Halbleiter'],
    kraftheinz: ['KHC', 'Kraft Heinz', 'Konsum'], lamresearch: ['LRCX', 'Lam Research', 'Halbleiter'], linde: ['LIN', 'Linde', 'Chemie'],
    lululemon: ['LULU', 'Lululemon', 'Konsum'], lumentum: ['LITE', 'Lumentum', 'Technologie'], marriott: ['MAR', 'Marriott', 'Konsum'],
    marvell: ['MRVL', 'Marvell', 'Halbleiter'], mercadolibre: ['MELI', 'MercadoLibre', 'Handel'], meta: ['META', 'Meta', 'Technologie'],
    microchip: ['MCHP', 'Microchip', 'Halbleiter'], micron: ['MU', 'Micron', 'Halbleiter'], microsoft: ['MSFT', 'Microsoft', 'Software'],
    mondelez: ['MDLZ', 'Mondelez', 'Konsum'], monolithic: ['MPWR', 'Monolithic Power', 'Halbleiter'], monster: ['MNST', 'Monster Beverage', 'Konsum'],
    netflix: ['NFLX', 'Netflix', 'Medien'], nvidia: ['NVDA', 'Nvidia', 'Halbleiter'], nxp: ['NXPI', 'NXP', 'Halbleiter'],
    oreilly: ['ORLY', "O'Reilly", 'Handel'], olddominion: ['ODFL', 'Old Dominion', 'Industrie'], onsemi: ['ON', 'onsemi', 'Halbleiter'],
    paccar: ['PCAR', 'PACCAR', 'Auto'], palantir: ['PLTR', 'Palantir', 'Software'],
    paloalto: ['PANW', 'Palo Alto Networks', 'Software'], paychex: ['PAYX', 'Paychex', 'Software'], paypal: ['PYPL', 'PayPal', 'Finanzen'],
    pdd: ['PDD', 'PDD Holdings', 'Handel'], pepsico: ['PEP', 'PepsiCo', 'Konsum'], qualcomm: ['QCOM', 'Qualcomm', 'Halbleiter'],
    regeneron: ['REGN', 'Regeneron', 'Pharma'], rocketlab: ['RKLB', 'Rocket Lab', 'Industrie'], roper: ['ROP', 'Roper', 'Software'],
    rossstores: ['ROST', 'Ross Stores', 'Handel'], shopify: ['SHOP', 'Shopify', 'Software'], starbucks: ['SBUX', 'Starbucks', 'Konsum'],
    strategy: ['MSTR', 'Strategy', 'Software'], synopsys: ['SNPS', 'Synopsys', 'Software'],
    tmobile: ['TMUS', 'T-Mobile US', 'Telekom'], taketwo: ['TTWO', 'Take-Two', 'Medien'], tesla: ['TSLA', 'Tesla', 'Auto'],
    texasinstruments: ['TXN', 'Texas Instruments', 'Halbleiter'], thomsonreuters: ['TRI', 'Thomson Reuters', 'Medien'],
    tradedesk: ['TTD', 'The Trade Desk', 'Software'], verisk: ['VRSK', 'Verisk', 'Software'],
    vertex: ['VRTX', 'Vertex', 'Pharma'], warnerbros: ['WBD', 'Warner Bros.', 'Medien'], workday: ['WDAY', 'Workday', 'Software'],
    xcel: ['XEL', 'Xcel Energy', 'Versorger'], zscaler: ['ZS', 'Zscaler', 'Software'], walmart: ['WMT', 'Walmart', 'Handel'],
    '3m': ['MMM', '3M', 'Industrie'], americanexpress: ['AXP', 'American Express', 'Finanzen'], boeing: ['BA', 'Boeing', 'Industrie'],
    caterpillar: ['CAT', 'Caterpillar', 'Industrie'], chevron: ['CVX', 'Chevron', 'Energie'], cocacola: ['KO', 'Coca-Cola', 'Konsum'],
    goldmansachs: ['GS', 'Goldman Sachs', 'Finanzen'], homedepot: ['HD', 'Home Depot', 'Handel'], ibm: ['IBM', 'IBM', 'Technologie'],
    johnsonjohnson: ['JNJ', 'Johnson & Johnson', 'Pharma'], jpmorgan: ['JPM', 'JPMorgan', 'Finanzen'],
    mcdonalds: ['MCD', "McDonald's", 'Konsum'], merck: ['MRK', 'Merck & Co.', 'Pharma'], nike: ['NKE', 'Nike', 'Konsum'],
    proctergamble: ['PG', 'Procter & Gamble', 'Konsum'], salesforce: ['CRM', 'Salesforce', 'Software'], sherwinwilliams: ['SHW', 'Sherwin-Williams', 'Chemie'],
    travelers: ['TRV', 'Travelers', 'Versicherung'], unitedhealth: ['UNH', 'UnitedHealth', 'Gesundheit'], visa: ['V', 'Visa', 'Finanzen'],
    disney: ['DIS', 'Disney', 'Medien'], verizon: ['VZ', 'Verizon', 'Telekom'],
    moderna: ['MRNA', 'Moderna', 'Pharma'], nebius: ['NBIS', 'Nebius', 'Technologie'], sandisk: ['SNDK', 'Sandisk', 'Technologie'],
    seagate: ['STX', 'Seagate', 'Technologie'], teradyne: ['TER', 'Teradyne', 'Halbleiter'], westerndigital: ['WDC', 'Western Digital', 'Technologie'],
    abbott: ['ABT', 'Abbott', 'Gesundheit'], abbvie: ['ABBV', 'AbbVie', 'Pharma'], accenture: ['ACN', 'Accenture', 'Software'],
    bankofamerica: ['BAC', 'Bank of America', 'Finanzen'], berkshire: ['BRK.B', 'Berkshire Hathaway', 'Finanzen'], blackrock: ['BLK', 'BlackRock', 'Finanzen'],
    bristolmyers: ['BMY', 'Bristol-Myers Squibb', 'Pharma'], citigroup: ['C', 'Citigroup', 'Finanzen'], conocophillips: ['COP', 'ConocoPhillips', 'Energie'],
    danaher: ['DHR', 'Danaher', 'Gesundheit'], lilly: ['LLY', 'Eli Lilly', 'Pharma'], exxon: ['XOM', 'ExxonMobil', 'Energie'],
    geaerospace: ['GE', 'GE Aerospace', 'Industrie'], gevernova: ['GEV', 'GE Vernova', 'Energie'], generalmotors: ['GM', 'General Motors', 'Auto'],
    ford: ['F', 'Ford', 'Auto'], lockheed: ['LMT', 'Lockheed Martin', 'Rüstung'], mastercard: ['MA', 'Mastercard', 'Finanzen'],
    morganstanley: ['MS', 'Morgan Stanley', 'Finanzen'], nextera: ['NEE', 'NextEra Energy', 'Versorger'], oracle: ['ORCL', 'Oracle', 'Software'],
    pfizer: ['PFE', 'Pfizer', 'Pharma'], philipmorris: ['PM', 'Philip Morris', 'Konsum'], rtx: ['RTX', 'RTX', 'Rüstung'],
    servicenow: ['NOW', 'ServiceNow', 'Software'], thermofisher: ['TMO', 'Thermo Fisher', 'Gesundheit'], uber: ['UBER', 'Uber', 'Technologie'],
    unionpacific: ['UNP', 'Union Pacific', 'Industrie'], ups: ['UPS', 'UPS', 'Industrie'], wellsfargo: ['WFC', 'Wells Fargo', 'Finanzen'],
    deere: ['DE', 'Deere', 'Industrie'], lowes: ['LOW', 'Lowe’s', 'Handel'], target: ['TGT', 'Target', 'Handel'], kkr: ['KKR', 'KKR', 'Finanzen'],
    charlesschwab: ['SCHW', 'Charles Schwab', 'Finanzen'], spglobal: ['SPGI', 'S&P Global', 'Finanzen'], bostonscientific: ['BSX', 'Boston Scientific', 'Gesundheit'],
    stryker: ['SYK', 'Stryker', 'Gesundheit'], medtronic: ['MDT', 'Medtronic', 'Gesundheit'], cvshealth: ['CVS', 'CVS Health', 'Gesundheit'],
    coinbase: ['COIN', 'Coinbase', 'Finanzen'], robinhood: ['HOOD', 'Robinhood', 'Finanzen'], dell: ['DELL', 'Dell', 'Technologie'],
    supermicro: ['SMCI', 'Super Micro', 'Technologie'], arista: ['ANET', 'Arista Networks', 'Technologie'], vistra: ['VST', 'Vistra', 'Versorger'],
    eaton: ['ETN', 'Eaton', 'Industrie'], freeport: ['FCX', 'Freeport-McMoRan', 'Rohstoffe'], newmont: ['NEM', 'Newmont', 'Rohstoffe'],
    occidental: ['OXY', 'Occidental', 'Energie'], schlumberger: ['SLB', 'SLB', 'Energie'], colgate: ['CL', 'Colgate-Palmolive', 'Konsum'],
    altria: ['MO', 'Altria', 'Konsum'], att: ['T', 'AT&T', 'Telekom'], amphenol: ['APH', 'Amphenol', 'Technologie'],
    americantower: ['AMT', 'American Tower', 'Immobilien'], prologis: ['PLD', 'Prologis', 'Immobilien'], chubb: ['CB', 'Chubb', 'Versicherung'],
    progressive: ['PGR', 'Progressive', 'Versicherung'], welltower: ['WELL', 'Welltower', 'Immobilien'], hca: ['HCA', 'HCA Healthcare', 'Gesundheit'],
    elevance: ['ELV', 'Elevance Health', 'Gesundheit'], cigna: ['CI', 'Cigna', 'Gesundheit'], firstsolar: ['FSLR', 'First Solar', 'Energie'],
    enphase: ['ENPH', 'Enphase', 'Energie'], carnival: ['CCL', 'Carnival', 'Konsum'], royalcaribbean: ['RCL', 'Royal Caribbean', 'Konsum'],
    delta: ['DAL', 'Delta Air Lines', 'Industrie'], unitedairlines: ['UAL', 'United Airlines', 'Industrie'], generaldynamics: ['GD', 'General Dynamics', 'Rüstung'],
    northrop: ['NOC', 'Northrop Grumman', 'Rüstung'], blackstone: ['BX', 'Blackstone', 'Finanzen'], hpe: ['HPE', 'HPE', 'Technologie'],
    hp: ['HPQ', 'HP', 'Technologie'], corning: ['GLW', 'Corning', 'Technologie'], vertiv: ['VRT', 'Vertiv', 'Industrie']
  };
  var CRYPTO_SKIP = { USDT: 1, USDC: 1, USDE: 1, DAI: 1, FDUSD: 1, PYUSD: 1, USD1: 1, USDS: 1, TUSD: 1, WBTC: 1, WETH: 1, WBETH: 1,
    WEETH: 1, STETH: 1, WSTETH: 1, LEO: 1, BUIDL: 1, USDTB: 1, RLUSD: 1, USDD: 1, CBBTC: 1, XAUT: 1, PAXG: 1, BSC_USD: 1, FIGR_HELOC: 1 };
  var CRYPTO_NAMES = { BTC: 'Bitcoin', ETH: 'Ethereum', XRP: 'XRP', BNB: 'BNB', SOL: 'Solana', TRX: 'TRON', DOGE: 'Dogecoin', ADA: 'Cardano',
    HYPE: 'Hyperliquid', LINK: 'Chainlink', XLM: 'Stellar', BCH: 'Bitcoin Cash', LTC: 'Litecoin', AVAX: 'Avalanche', SUI: 'Sui',
    XMR: 'Monero', ZEC: 'Zcash', DOT: 'Polkadot', TON: 'Toncoin', HBAR: 'Hedera', SHIB: 'Shiba Inu', UNI: 'Uniswap', NEAR: 'NEAR' };

  function emptyMarket() {
    return { v: VERSION, updatedAt: 0, fx: { EURUSD: 1.12, t: 0 }, macro: {}, q: {}, runs: 0, srcOk: {} };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function r4(x) {
    if (!isFinite(x)) return x;
    var a = Math.abs(x);
    var d = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
    return +x.toFixed(d);
  }
  function addPoint(q, t, p) {
    if (!q.h) q.h = [];
    var tm = Math.round(t / MIN);
    var last = q.h[q.h.length - 1];
    if (last && last[0] >= tm) return;
    var prev = q.h[q.h.length - 2];
    // höchstens ein Punkt pro ~Stunde: innerhalb von 55 Min. wird der letzte Punkt ersetzt
    if (last && prev && tm - prev[0] < 55) { last[0] = tm; last[1] = +(+p).toPrecision(6); return; }
    q.h.push([tm, +(+p).toPrecision(6)]);
    if (q.h.length > 30) q.h.splice(0, q.h.length - 30);
  }

  /* Kurse einlesen. data = { quotes: [{id,n,s,m,c,sec,p,ch,t,mc}], macro: {KEY: {n,v,ch}}, eurusd } */
  function ingestQuotes(prev, data, runTime) {
    var m = prev && prev.q ? clone(prev) : emptyMarket();
    var log = [], changed = {}, okCount = {};
    m.srcOk = { de: 0, us: 0, cr: 0 };
    (data.quotes || []).forEach(function (x) {
      var p = +x.p, t = +x.t || runTime;
      if (!(p > 0) || !isFinite(p) || t > runTime + 10 * MIN || t < runTime - 7 * DAY) return;
      var q = m.q[x.id];
      if (q && q.t && t < q.t) return;
      if (q && q.t === t && q.p === r4(p)) { m.srcOk[x.m] = (m.srcOk[x.m] || 0) + 1; return; }
      if (q && q.p > 0) {
        var jump = Math.abs(p / q.p - 1), ageDays = (t - (q.t || 0)) / DAY;
        if (jump > (x.m === 'cr' ? 0.5 : 0.4) && ageDays < 5) { log.push('Plausibilitätsprüfung: ' + x.n + ' ignoriert'); return; }
      }
      if (!q) q = m.q[x.id] = { h: [] };
      q.n = x.n; q.s = x.s; q.m = x.m; q.c = x.c; q.sec = x.sec || 'Sonstige';
      if (x.mc) q.mc = x.mc;
      var ch = +x.ch;
      if (!isFinite(ch)) q.nc = 1; else delete q.nc;
      q.p = r4(p); q.ch = isFinite(ch) ? +ch.toFixed(2) : 0; q.t = t;
      addPoint(q, t, p);
      changed[x.id] = 1;
      okCount[x.m] = (okCount[x.m] || 0) + 1;
      m.srcOk[x.m] = (m.srcOk[x.m] || 0) + 1;
    });
    if (data.eurusd > 0.8 && data.eurusd < 1.6) m.fx = { EURUSD: +(+data.eurusd).toFixed(5), t: runTime };
    var mac = data.macro || {};
    Object.keys(mac).forEach(function (k) {
      var x = mac[k]; if (!(x && x.v > 0)) return;
      var old = m.macro[k];
      var o = m.macro[k] = { n: x.n, v: x.v, ch: isFinite(+x.ch) ? +(+x.ch).toFixed(2) : 0, t: runTime, h: (old && old.h) || [] };
      var lastH = o.h[o.h.length - 1];
      if (!lastH || runTime / MIN - lastH[0] >= 55) { o.h.push([Math.round(runTime / MIN), x.v]); if (o.h.length > 40) o.h.splice(0, o.h.length - 40); }
      else lastH[1] = x.v;
    });
    m.updatedAt = runTime; m.runs = (m.runs || 0) + 1; m.v = VERSION;
    return { market: m, changed: changed, log: log, counts: okCount };
  }

  /* ---------------- Aufteilung in Dateien ---------------- */
  function letterOf(id) { var x = id.indexOf('US-') === 0 ? id.slice(3) : id; return (x[0] || 'Z').toUpperCase(); }
  function dailyShard(id, q) {
    if (q.m === 'de') return 'de';
    if (q.m === 'cr') return 'cr';
    var l = letterOf(id);
    return l <= 'F' ? 'us1' : l <= 'M' ? 'us2' : l <= 'S' ? 'us3' : 'us4';
  }
  function quoteShard(id, q) { return dailyShard(id, q); }
  var QUOTE_SHARDS = ['de', 'cr', 'us1', 'us2', 'us3', 'us4'];
  var DAILY_SHARDS = ['de', 'cr', 'us1', 'us2', 'us3', 'us4'];
  function dayNum(ms) { var p = partsIn(ms); return Math.round(Date.UTC(p.y, p.mo - 1, p.d) / DAY); }
  function splitMarket(market) {
    var meta = {}, shards = {};
    Object.keys(market).forEach(function (k) { if (k !== 'q') meta[k] = market[k]; });
    QUOTE_SHARDS.forEach(function (s) { shards[s] = { q: {} }; });
    Object.keys(market.q).forEach(function (id) { shards[quoteShard(id, market.q[id])].q[id] = market.q[id]; });
    return { meta: meta, shards: shards };
  }
  function joinMarket(meta, shards) {
    var m = meta && meta.updatedAt != null ? clone(meta) : emptyMarket();
    m.q = {};
    Object.keys(shards || {}).forEach(function (s) {
      var d = shards[s]; if (!d || !d.q) return;
      Object.keys(d.q).forEach(function (id) { m.q[id] = d.q[id]; });
    });
    return m;
  }
  /* Tagesschlusskurse (letzter Kurs je Tag), 80 Tage je Wert */
  function updateDaily(daily, market, changed) {
    var touched = {};
    Object.keys(changed).forEach(function (id) {
      var q = market.q[id]; if (!q) return;
      var sh = dailyShard(id, q);
      var doc = daily[sh] || (daily[sh] = { d: {} });
      if (!doc.d) doc.d = {};
      var arr = doc.d[id] || (doc.d[id] = []);
      var dn = dayNum(q.t);
      var last = arr[arr.length - 1];
      if (last && last[0] === dn) last[1] = r4(q.p);
      else if (!last || last[0] < dn) arr.push([dn, r4(q.p)]);
      if (arr.length > 260) arr.splice(0, arr.length - 260);
      touched[sh] = 1;
    });
    return touched;
  }

  /* ---------------- Hilfen für Bewertung ---------------- */
  function fxToEur(cur, fx) { return cur === 'USD' ? 1 / ((fx && fx.EURUSD) || 1.12) : 1; }
  function priceEur(q, fx) { return q.p * fxToEur(q.c, fx); }
  function fee(valueEur, feePct) { var f = valueEur * (feePct == null ? 0.1 : feePct) / 100; return Math.max(1, +f.toFixed(2)); }
  function isFresh(q, market, now) {
    if (!q || !q.t || !market) return false;
    var ref = market.updatedAt || q.t;
    if (q.m === 'cr') return (now || ref) - q.t < 3 * HOUR;
    if (q.t < ref - 100 * MIN) return false;           // Kurs älter als ~1,5 h vor letzter Aktualisierung
    if (now && now - ref > 3 * HOUR) return false;      // Datenstand insgesamt zu alt
    return true;
  }
  function canTrade(q, market, now) { return !!q && isFresh(q, market, now) && isOpen(q.m, now); }
  var BASE_VOL = { de: 1.6, us: 2.0, cr: 3.5 }; // typische Tagesschwankung in %
  var STEPS_PER_DAY = { de: 8, us: 7, cr: 10 };
  function indicators(q) {
    var h = q.h || [], n = h.length;
    var base = BASE_VOL[q.m] || 2;
    var rets = [];
    for (var i = 1; i < n; i++) if (h[i - 1][1] > 0) rets.push(h[i][1] / h[i - 1][1] - 1);
    var est = null;
    if (rets.length >= 5) {
      var mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
      var v = rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (rets.length - 1);
      est = Math.sqrt(v) * Math.sqrt(STEPS_PER_DAY[q.m] || 8) * 100;
    }
    var dayVol = est == null ? base : Math.max(base * 0.6, Math.min(base * 3, est));
    dayVol = Math.max(dayVol, Math.abs(q.ch || 0) * 0.5);
    var step = rets.length ? rets[rets.length - 1] * 100 : null;
    var ema = null, k = 2 / (Math.min(n, 10) + 1);
    for (var j = 0; j < n; j++) ema = ema == null ? h[j][1] : h[j][1] * k + ema * (1 - k);
    var span = n >= 2 ? (h[n - 1][0] - h[0][0]) / 60 : 0; // Stunden
    var retAll = n >= 2 ? (h[n - 1][1] / h[0][1] - 1) * 100 : null;
    var ret3 = n >= 4 ? (h[n - 1][1] / h[n - 4][1] - 1) * 100 : null;
    return { dayVol: dayVol, step: step, ema: ema, n: n, spanH: span, retAll: retAll, ret3: ret3 };
  }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

  /* ---------------- Bot ---------------- */
  var STRATS = {
    mom: { n: 'Momentum', d: 'kurzfristig: kauft Werte, die gerade stark steigen' },
    trend: { n: 'Trend', d: 'mittelfristig: hält Werte mit stabilem Aufwärtstrend' },
    reb: { n: 'Rebound', d: 'kurzfristig: kauft starke Verlierer, sobald sie drehen' }
  };
  var LEVELS = [
    { n: 'Vorsichtig', rpt: 0.8, maxPct: 10, maxPos: 6, reserve: 25, crMax: 15 },
    { n: 'Ausgewogen', rpt: 1.5, maxPct: 15, maxPos: 9, reserve: 10, crMax: 30 },
    { n: 'Aggressiv', rpt: 2.5, maxPct: 25, maxPos: 12, reserve: 3, crMax: 40 }
  ];
  var RISK_MAX = { niedrig: 0, mittel: 1, hoch: 2 };
  function defaultSettings() {
    return { enabled: true, risk: 'hoch', markets: { us: true, de: true, cr: true }, feePct: 0.1, resetAt: 0 };
  }
  function newBot(now) {
    return {
      v: VERSION, createdAt: now, startCash: START_CASH, cash: START_CASH, pos: {}, trades: [], closed: [],
      w: { mom: 0.45, trend: 0.33, reb: 0.22 }, lvl: 2, eq: [[Math.round(now / MIN), START_CASH]], peak: START_CASH, maxDD: 0,
      log: [{ t: now, k: 'info', x: 'Auto-Trader gestartet mit 100.000 € Startkapital.' }], cd: {}, runs: 0, lastRun: 0,
      stats: { n: 0, wins: 0, realized: 0, fees: 0, best: null, worst: null }
    };
  }
  function fmtEur(x) {
    var s = Math.abs(x).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (x < 0 ? '−' : '') + s + ' €';
  }
  function fmtPct(x, d) { var s = Math.abs(x).toFixed(d == null ? 1 : d).replace('.', ','); return (x > 0 ? '+' : x < 0 ? '−' : '') + s + ' %'; }
  function fmtQty(q, m) { return m === 'cr' ? String(+q.toFixed(q < 1 ? 6 : 4)).replace('.', ',') : String(q); }

  function equityOf(bot, market) {
    var v = bot.cash;
    Object.keys(bot.pos).forEach(function (id) {
      var p = bot.pos[id], q = market.q[id];
      var price = q ? q.p : p.lp || p.p0;
      v += p.q * price * fxToEur(p.c, market.fx);
    });
    return v;
  }

  function runBot(botIn, settingsIn, market, now) {
    var settings = Object.assign(defaultSettings(), settingsIn || {});
    settings.markets = Object.assign({ us: true, de: true, cr: true }, settings.markets || {});
    var bot = botIn && botIn.v ? clone(botIn) : newBot(now);
    var events = [];
    function log(k, x) { bot.log.push({ t: now, k: k, x: x }); events.push(x); }

    if (settings.resetAt && settings.resetAt > bot.createdAt) {
      bot = newBot(now);
      bot.log[0].x = 'Auto-Trader zurückgesetzt – neuer Start mit 100.000 €.';
    }
    var maxLvl = RISK_MAX[settings.risk] == null ? 2 : RISK_MAX[settings.risk];
    if (bot.lvl > maxLvl) bot.lvl = maxLvl;
    var fx = market.fx;
    var feePct = settings.feePct == null ? 0.1 : settings.feePct;

    // Kurse in Positionen aktualisieren
    Object.keys(bot.pos).forEach(function (id) {
      var p = bot.pos[id], q = market.q[id];
      if (q) { p.lp = q.p; if (q.p > (p.pk || 0)) p.pk = q.p; }
    });

    function sell(id, why) {
      var p = bot.pos[id], q = market.q[id];
      var valEur = p.q * q.p * fxToEur(p.c, fx);
      var f = fee(valEur, feePct);
      var proceeds = valEur - f;
      var pl = proceeds - p.cost, pp = pl / p.cost * 100;
      bot.cash += proceeds;
      bot.trades.push({ i: id, n: q.s, s: 'V', q: p.q, p: q.p, c: p.c, v: +valEur.toFixed(2), f: f, t: now, st: p.st, r: why, pl: +pl.toFixed(2), pp: +pp.toFixed(2) });
      bot.closed.push({ st: p.st, pp: +pp.toFixed(2), pl: +pl.toFixed(2), t: now, i: id });
      if (bot.closed.length > 200) bot.closed.splice(0, bot.closed.length - 200);
      var s = bot.stats; s.n++; if (pl > 0) s.wins++; s.realized = +(s.realized + pl).toFixed(2); s.fees = +(s.fees + f).toFixed(2);
      if (!s.best || pl > s.best.pl) s.best = { n: q.n, pl: +pl.toFixed(2), pp: +pp.toFixed(2), t: now };
      if (!s.worst || pl < s.worst.pl) s.worst = { n: q.n, pl: +pl.toFixed(2), pp: +pp.toFixed(2), t: now };
      bot.cd[id] = now + (pl < 0 ? 12 * HOUR : 2 * HOUR);
      delete bot.pos[id];
      log(pl >= 0 ? 'win' : 'loss', 'Verkauft: ' + fmtQty(p.q, q.m) + ' × ' + q.n + ' ' + (pl >= 0 ? 'mit Gewinn ' : 'mit Verlust ') + fmtEur(pl) + ' (' + fmtPct(pp) + ') – ' + why + '.');
    }

    // 1) Ausstiege prüfen
    if (settings.enabled) {
      Object.keys(bot.pos).forEach(function (id) {
        var p = bot.pos[id], q = market.q[id];
        if (!canTrade(q, market, now)) return;
        var pr = q.p, held = now - p.t0;
        var gain = (pr / p.p0 - 1) * 100;
        var trailLine = p.pk * (1 - p.tr / 100);
        if (pr <= p.sl) return sell(id, 'Stop-Loss ausgelöst (Verlust begrenzt)');
        if (p.tp && pr >= p.tp) return sell(id, 'Gewinnziel erreicht');
        if (p.pk >= p.p0 * (1 + p.tr / 100) && pr <= trailLine) return sell(id, 'Gewinne gesichert (Kurs fiel vom Hoch zurück)');
        if (p.st === 'mom' && held > 4 * DAY && gain < 2) return sell(id, 'Momentum verpufft (Zeitlimit)');
        if (p.st === 'reb' && held > 2.5 * DAY) return sell(id, 'Gegenbewegung blieb aus (Zeitlimit)');
        if (p.st === 'trend' && held > 30 * DAY) return sell(id, 'Haltedauer erreicht, Gewinne mitgenommen');
        if (p.st === 'trend') {
          var ind = indicators(q);
          if (ind.n >= 8 && ind.ema && pr < ind.ema * (1 - p.tr / 200) && held > 1 * DAY) return sell(id, 'Aufwärtstrend gebrochen');
        }
      });
    }

    // 2) Anpassung an die eigene Leistung
    var eqNow = equityOf(bot, market);
    if (eqNow > bot.peak) bot.peak = eqNow;
    var dd = (1 - eqNow / bot.peak) * 100;
    if (dd > bot.maxDD) bot.maxDD = +dd.toFixed(2);
    function pf(arr) {
      var w = 0, l = 0; arr.forEach(function (c) { if (c.pl > 0) w += c.pl; else l -= c.pl; });
      return l === 0 ? (w > 0 ? 9 : 1) : w / l;
    }
    var last = bot.closed.slice(-8);
    var lastLoss = last.filter(function (c) { return c.pl < 0; }).length;
    var recent10 = bot.closed.slice(-10);
    var pf8 = pf(last), pf10 = pf(recent10);
    var oldLvl = bot.lvl, why = '';
    var target = bot.lvl;
    if (dd > 10) { target = 0; why = 'Depot liegt ' + dd.toFixed(1).replace('.', ',') + ' % unter dem Höchststand'; }
    else if (dd > 5 && target > maxLvl - 1) { target = Math.max(0, maxLvl - 1); why = 'Rückgang von ' + dd.toFixed(1).replace('.', ',') + ' % seit dem Höchststand'; }
    else if (now - (bot.lvlT || 0) < 24 * HOUR) { /* nach einer Änderung 24 h abwarten */ }
    else if (last.length >= 6 && lastLoss >= 5 && pf8 < 0.7) { target = Math.max(0, bot.lvl - 1); why = lastLoss + ' der letzten ' + last.length + ' Trades mit Verlust'; }
    else if (dd < 2 && recent10.length >= 6 && pf10 >= 1.3 && bot.lvl < maxLvl) { target = bot.lvl + 1; why = 'Gewinne übersteigen Verluste deutlich (Faktor ' + pf10.toFixed(1).replace('.', ',') + ') und Depot nahe Höchststand'; }
    else if (dd < 1 && bot.lvl < maxLvl && bot.closed.length < 6) { target = maxLvl; }
    target = clamp(target, 0, maxLvl);
    if (target !== oldLvl) {
      bot.lvl = target; bot.lvlT = now;
      if (why) log('adapt', (target < oldLvl ? 'Risiko gesenkt auf „' : 'Risiko erhöht auf „') + LEVELS[target].n + '“: ' + why + '.');
    }
    // Strategie-Gewichte nach Ergebnis der letzten Trades
    var oldW = clone(bot.w), base = { mom: 0.45, trend: 0.33, reb: 0.22 };
    var nw = {}, sum = 0;
    Object.keys(base).forEach(function (s) {
      var cl = bot.closed.filter(function (c) { return c.st === s; }).slice(-12);
      var avg = cl.length ? cl.reduce(function (a, c) { return a + c.pp; }, 0) / cl.length : 0;
      var conf = Math.min(1, cl.length / 6);
      nw[s] = base[s] * Math.exp(clamp(avg, -6, 6) * 0.25 * conf);
      sum += nw[s];
    });
    Object.keys(nw).forEach(function (s) { nw[s] = clamp(nw[s] / sum, 0.08, 0.7); });
    sum = nw.mom + nw.trend + nw.reb;
    Object.keys(nw).forEach(function (s) { nw[s] = +(nw[s] / sum).toFixed(3); });
    bot.w = nw;
    var shift = Object.keys(nw).map(function (s) { return [s, nw[s] - (oldW[s] || 0)]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (shift[0][1] > 0.06 && now - (bot.mixT || 0) > 12 * HOUR) { bot.mixT = now; } else shift = null;
    if (shift) log('adapt', 'Strategie-Mix angepasst: mehr Kapital für „' + STRATS[shift[0][0]].n + '“ (' + Math.round(nw[shift[0][0]] * 100) + ' %), weniger für „' + STRATS[shift[2][0]].n + '“ (' + Math.round(nw[shift[2][0]] * 100) + ' %).');

    var L = LEVELS[bot.lvl];

    // 3) Kaufsignale
    var cands = [];
    if (settings.enabled) {
      Object.keys(market.q).forEach(function (id) {
        var q = market.q[id];
        if (bot.pos[id] || !settings.markets[q.m] || !canTrade(q, market, now)) return;
        if (bot.cd[id] && bot.cd[id] > now) return;
        var ind = indicators(q), ch = q.ch || 0, dv = ind.dayVol;
        var crypto = q.m === 'cr';
        var best = null;
        // Momentum
        var thr = crypto ? 3 : q.m === 'de' ? 1.5 : 2;
        if (ch >= thr && ch <= (crypto ? 30 : 18) && (ind.step == null || ind.step >= -0.25)) {
          var sc = ch / dv + (ind.step != null ? clamp(ind.step, -1, 3) * 0.8 : 0) + (ind.ret3 != null && ind.ret3 > 0 ? 0.4 : 0);
          var why1 = (crypto ? fmtPct(ch) + ' in 24 h' : fmtPct(ch) + ' heute') + (ind.step != null && ind.step > 0 ? ', steigt weiter' : '');
          best = { st: 'mom', sc: sc, why: 'Momentum: ' + why1 };
        }
        // Trend
        if (ind.n >= 6 && ind.spanH >= 20 && ind.retAll > 0 && q.p > ind.ema && ch > -0.5) {
          var sc2 = (ind.retAll / dv) * 0.7 + ((q.p / ind.ema - 1) * 100 / dv) * 1.5;
          if (!best || sc2 > best.sc) best = { st: 'trend', sc: sc2, why: 'Trend: ' + fmtPct(ind.retAll) + ' über ' + String(Math.round(ind.spanH / 24 * 10) / 10).replace('.', ',') + ' Tage, Kurs über dem Durchschnitt' };
        }
        // Rebound
        var thrR = crypto ? -7 : q.m === 'de' ? -4 : -4.5;
        if (ch <= thrR && ch >= (crypto ? -35 : -25) && ind.step != null && ind.step > 0.1) {
          var sc3 = Math.abs(ch) / dv * 0.7 + clamp(ind.step, 0, 4);
          if (!best || sc3 > best.sc) best = { st: 'reb', sc: sc3, why: 'Rebound: ' + fmtPct(ch) + (crypto ? ' in 24 h' : ' heute') + ', dreht jetzt nach oben (' + fmtPct(ind.step) + ')' };
        }
        if (!best) return;
        best.sc = best.sc * (0.5 + bot.w[best.st]);
        if (best.sc < 1.0) return;
        best.id = id; best.dv = dv; best.q = q;
        cands.push(best);
      });
      cands.sort(function (a, b) { return b.sc - a.sc; });
    }
    bot.ideas = cands.slice(0, 8).map(function (c) { return { i: c.id, n: c.q.n, st: c.st, sc: +c.sc.toFixed(2), why: c.why }; });

    // 4) Rotation: schwache Position gegen deutlich stärkeren Kandidaten tauschen
    var posIds = Object.keys(bot.pos);
    if (settings.enabled && cands.length && posIds.length >= L.maxPos && cands[0].sc > 2.5 && now - (bot.rotT || 0) > 12 * HOUR) {
      var weakest = null;
      posIds.forEach(function (id) {
        var p = bot.pos[id], q = market.q[id];
        if (!canTrade(q, market, now) || now - p.t0 < 6 * HOUR) return;
        var g = (q.p / p.p0 - 1) * 100;
        if (g < 0.5 && (!weakest || g < weakest.g)) weakest = { id: id, g: g };
      });
      if (weakest) { bot.rotT = now; sell(weakest.id, 'Platz gemacht für stärkeren Kandidaten (' + cands[0].q.n + ')'); }
    }

    // 5) Kaufen
    var bought = 0;
    if (settings.enabled) {
      var equity = equityOf(bot, market);
      var invested = {}, investedCr = 0;
      Object.keys(bot.pos).forEach(function (id) {
        var p = bot.pos[id], q = market.q[id];
        var v = p.q * (q ? q.p : p.p0) * fxToEur(p.c, fx);
        invested[p.st] = (invested[p.st] || 0) + v;
        if (p.m === 'cr') investedCr += v;
      });
      for (var ci = 0; ci < cands.length && bought < 4; ci++) {
        if (Object.keys(bot.pos).length >= L.maxPos) break;
        var c = cands[ci], q = c.q;
        var crypto = q.m === 'cr';
        var sl, tp, tr;
        if (c.st === 'mom') { sl = clamp(1.5 * c.dv, 2.5, crypto ? 9 : 7); tp = sl * 2.2; tr = sl; }
        else if (c.st === 'trend') { sl = clamp(2.5 * c.dv, 4, crypto ? 15 : 12); tp = null; tr = sl; }
        else { sl = clamp(1.5 * c.dv, 3, crypto ? 10 : 8); tp = clamp(1.0 * c.dv, 2.5, crypto ? 8 : 6); tr = sl; }
        var riskEur = equity * L.rpt / 100;
        var want = riskEur / (sl / 100);
        want = Math.min(want, equity * L.maxPct / 100);
        var budgetLeft = equity * (1 - L.reserve / 100) * bot.w[c.st] * 1.6 - (invested[c.st] || 0);
        want = Math.min(want, budgetLeft);
        if (crypto) want = Math.min(want, equity * L.crMax / 100 - investedCr);
        var spendable = bot.cash - equity * L.reserve / 100;
        want = Math.min(want, spendable / (1 + feePct / 100) - 2);
        if (want < 500) continue;
        var pxEur = priceEur(q, fx);
        var qty = crypto ? Math.floor(want / pxEur * 1e6) / 1e6 : Math.floor(want / pxEur);
        if (qty <= 0) continue;
        var val = qty * pxEur;
        if (val < 300) continue;
        var f = fee(val, feePct);
        bot.cash -= val + f;
        bot.stats.fees = +(bot.stats.fees + f).toFixed(2);
        bot.pos[c.id] = { q: qty, p0: q.p, c: q.c, cost: +(val + f).toFixed(2), t0: now, st: c.st,
          sl: r4(q.p * (1 - sl / 100)), tp: tp ? r4(q.p * (1 + tp / 100)) : null, tr: +tr.toFixed(2), pk: q.p, lp: q.p, r: c.why, m: q.m };
        invested[c.st] = (invested[c.st] || 0) + val;
        if (crypto) investedCr += val;
        bot.trades.push({ i: c.id, n: q.s, s: 'K', q: qty, p: q.p, c: q.c, v: +val.toFixed(2), f: f, t: now, st: c.st, r: c.why });
        log('buy', 'Gekauft: ' + fmtQty(qty, q.m) + ' × ' + q.n + ' für ' + fmtEur(val) + ' – ' + c.why + '. Stop bei ' + fmtPct(-sl) + (tp ? ', Ziel ' + fmtPct(tp) : ', Trailing-Stop') + '.');
        bought++;
      }
    }

    // 6) Bewertung & Verlauf
    var eqEnd = equityOf(bot, market);
    if (eqEnd > bot.peak) bot.peak = eqEnd;
    var dd2 = (1 - eqEnd / bot.peak) * 100; if (dd2 > bot.maxDD) bot.maxDD = +dd2.toFixed(2);
    var tm = Math.round(now / MIN);
    var lastEq = bot.eq[bot.eq.length - 1];
    if (!lastEq || lastEq[0] < tm) bot.eq.push([tm, +eqEnd.toFixed(2)]);
    if (bot.eq.length > 3000) { // ältere Punkte ausdünnen
      var keep = bot.eq.slice(-1500), old = bot.eq.slice(0, -1500).filter(function (_, i) { return i % 2 === 0; });
      bot.eq = old.concat(keep);
    }
    if (bot.trades.length > 400) bot.trades.splice(0, bot.trades.length - 400);
    if (bot.log.length > 150) bot.log.splice(0, bot.log.length - 150);
    Object.keys(bot.cd).forEach(function (k) { if (bot.cd[k] < now) delete bot.cd[k]; });
    if (!settings.enabled && !bot.paused) log('info', 'Auto-Trader pausiert – es werden keine neuen Trades gemacht.');
    if (settings.enabled && bot.paused) log('info', 'Auto-Trader läuft wieder.');
    bot.paused = !settings.enabled;
    bot.equity = +eqEnd.toFixed(2);
    bot.runs = (bot.runs || 0) + 1;
    bot.lastRun = now;
    bot.v = VERSION;
    return { bot: bot, events: events, equity: eqEnd };
  }

  return {
    VERSION: VERSION, TZ: TZ, START_CASH: START_CASH, LEVELS: LEVELS, STRATS: STRATS, RISK_MAX: RISK_MAX,
    partsIn: partsIn, zonedToUtc: zonedToUtc, dayKey: dayKey, isOpen: isOpen,
    ingestQuotes: ingestQuotes, splitMarket: splitMarket, joinMarket: joinMarket, updateDaily: updateDaily, dayNum: dayNum,
    QUOTE_SHARDS: QUOTE_SHARDS, DAILY_SHARDS: DAILY_SHARDS, quoteShard: quoteShard, dailyShard: dailyShard, runBot: runBot, newBot: newBot, defaultSettings: defaultSettings,
    fxToEur: fxToEur, priceEur: priceEur, fee: fee, isFresh: isFresh, canTrade: canTrade, indicators: indicators, equityOf: equityOf,
    DE: DE, US: US, CRYPTO_NAMES: CRYPTO_NAMES, CRYPTO_SKIP: CRYPTO_SKIP, fmtEur: fmtEur, fmtPct: fmtPct, emptyMarket: emptyMarket
  };
});

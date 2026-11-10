/* Kurswerk Free – Datenanbindung ohne Server:
   liest die JSON-Dateien, die der GitHub-Actions-Bot veröffentlicht, und speichert eigene Änderungen
   (Einstellungen, eigenes Depot, Aussehen) im Browser und – mit GitHub-Schlüssel – im Repository. */
(function () {
  'use strict';
  var LS = { token: 'kurswerk.gh.token', repo: 'kurswerk.gh.repo', doc: 'kurswerk.doc.' };
  var USER_DOCS = { 'bot/settings': 1, 'manual/state': 1, 'prefs/ui': 1 };
  var POLL_MS = 60000;
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* ohne Speicher */ } }
  function fileOf(p) { return p.replace('/', '_'); }

  function detectRepo() {
    var saved = lsGet(LS.repo);
    if (saved && /^[\w.-]+\/[\w.-]+$/.test(saved)) return saved;
    var h = location.hostname;
    if (/\.github\.io$/i.test(h)) {
      var owner = h.split('.')[0], seg = location.pathname.split('/').filter(Boolean)[0];
      return owner + '/' + (seg && !/\.html?$/i.test(seg) ? seg : owner + '.github.io');
    }
    return '';
  }
  var cfg = { repo: detectRepo(), token: lsGet(LS.token) || '' };

  function snap(id, data) {
    return { id: id, exists: !!data, data: function () { return data ? JSON.parse(JSON.stringify(data)) : undefined; }, metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function localDoc(p) { try { var o = JSON.parse(lsGet(LS.doc + p) || 'null'); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
  function fetchDoc(p) {
    var url = 'data/' + fileOf(p) + '.json?t=' + Date.now();
    return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (server) {
        if (!USER_DOCS[p]) return server;
        var local = localDoc(p);
        if (local && (!server || (local._u || 0) >= (server._u || 0))) return local;
        return server;
      });
  }
  var subs = {}, timer = null;
  function poll() {
    Object.keys(subs).forEach(function (p) {
      fetchDoc(p).then(function (d) {
        var key = JSON.stringify(d);
        var s = subs[p]; if (!s || s.last === key) return;
        s.last = key; s.fns.forEach(function (fn) { try { fn(snap(p.split('/').pop(), d)); } catch (e) { console.error(e); } });
      });
    });
  }
  function ensureTimer() { if (!timer) timer = setInterval(poll, POLL_MS); }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') poll(); });

  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function gh(method, path, body) {
    return fetch('https://api.github.com/repos/' + cfg.repo + path, {
      method: method,
      headers: { Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  var queue = Promise.resolve();
  function pushFile(p, data) {
    var file = 'user/' + fileOf(p) + '.json';
    queue = queue.then(function () {
      return gh('GET', '/contents/' + file).then(function (r) { return r.ok ? r.json() : null; }).then(function (cur) {
        return gh('PUT', '/contents/' + file, { message: 'App: ' + p + ' aktualisiert', content: b64(JSON.stringify(data, null, 1)), sha: cur && cur.sha ? cur.sha : undefined });
      }).then(function (r) { if (!r.ok) throw new Error('GitHub ' + r.status); });
    });
    return queue;
  }
  var db = {
    doc: function (p) {
      return {
        get: function () { return fetchDoc(p).then(function (d) { return snap(p.split('/').pop(), d); }); },
        onSnapshot: function (next) {
          var s = subs[p] || (subs[p] = { fns: [], last: undefined });
          s.fns.push(next); ensureTimer();
          fetchDoc(p).then(function (d) { s.last = JSON.stringify(d); next(snap(p.split('/').pop(), d)); });
          return function () { s.fns = s.fns.filter(function (f) { return f !== next; }); };
        },
        set: function (data) {
          var d = JSON.parse(JSON.stringify(data)); d._u = Date.now();
          lsSet(LS.doc + p, JSON.stringify(d));
          var s = subs[p]; if (s) { s.last = JSON.stringify(d); s.fns.forEach(function (fn) { fn(snap(p.split('/').pop(), d)); }); }
          if (cfg.token && cfg.repo && USER_DOCS[p]) return pushFile(p, d);
          return Promise.resolve();
        },
        update: function (patch) { return this.get().then(function (sn) { return db.doc(p).set(Object.assign({}, sn.data() || {}, patch)); }); }
      };
    }
  };
  window.KWFREE = {
    db: db,
    cfg: cfg,
    connected: function () { return !!(cfg.token && cfg.repo); },
    save: function (repo, token) {
      cfg.repo = (repo || '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
      cfg.token = (token || '').trim();
      lsSet(LS.repo, cfg.repo || null); lsSet(LS.token, cfg.token || null);
      if (!cfg.token) return Promise.resolve(false);
      return gh('GET', '').then(function (r) { return r.ok; }).catch(function () { return false; });
    },
    refresh: function () {
      if (!cfg.token || !cfg.repo) return Promise.reject(new Error('kein Schlüssel'));
      return gh('POST', '/actions/workflows/bot.yml/dispatches', { ref: 'main' }).then(function (r) { if (!r.ok) throw new Error('GitHub ' + r.status); });
    },
    poll: poll
  };
})();

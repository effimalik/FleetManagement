/* ═══════════════════════════════════════════════════════════════
   dataLayer.js — AdminPro UAE
   v2.0 — Auth-gated cache, correct TTLs, auto-refresh timers,
           version checking, typed events, offline tolerance,
           authenticated GET + POST, DataLayer public API
   Load AFTER auth.js on every page:
     <script src="shared/auth.js"></script>
     <script src="shared/dataLayer.js"></script>
═══════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────
   0. GUARD — abort entirely if Auth is missing
───────────────────────────────────────── */
if (!window.Auth) {
  console.error('[DataLayer] auth.js must load before dataLayer.js');
  throw new Error('DataLayer requires Auth');
}

/* ─────────────────────────────────────────
   1. INTERNALS — not exposed publicly
───────────────────────────────────────── */
const _DL = (() => {

  const API_BASE = 'https://script.google.com/macros/s/AKfycbwsEytEt682yYVnWBD11Kh4hy_oXmbbmcUNdcDXGPDmMz_SmQeQBKM_8DYCe6sY225Ycg/exec';

  /* ── Master cache key (localStorage — survives logout for next login) ── */
  const CACHE_KEY = 'fleet_cache_v1';

  /* ── TTLs per spec ── */
  const TTL = {
    employees : 10 * 60 * 1000,   //  10 min
    bikes     : 15 * 60 * 1000,   //  15 min
    finance   :  5 * 60 * 1000,   //   5 min
    advances  :  5 * 60 * 1000,   //   5 min
    settings  : 60 * 60 * 1000,   //  60 min
    /* legacy keys kept for backwards compat */
    master    :  5 * 60 * 1000,
    cioLog    :  5 * 60 * 1000,
    recovery  :  6 * 60 * 60 * 1000,
  };

  /* ── Cross-page event names ── */
  const EVENTS = {
    employees : 'employeesUpdated',
    bikes     : 'bikesUpdated',
    finance   : 'financeUpdated',
    advances  : 'advancesUpdated',
    settings  : 'settingsUpdated',
    master    : 'masterUpdated',
    cioLog    : 'cioLogUpdated',
    recovery  : 'recoveryUpdated',
  };

  /* ── In-flight dedup ── */
  const _inFlight = {};

  /* ── Auto-refresh timer handles ── */
  const _timers = {};

  /* ── Last known server versions (from getVersions()) ── */
  let _serverVersions = {};

  /* ═══ CACHE ENGINE ═══ */
  const Cache = {

    _read() {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    },

    _write(store) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(store)); }
      catch (e) { console.warn('[DataLayer] Cache write failed:', e); }
    },

    get(dataset) {
      const store = this._read();
      const entry = store[dataset];
      if (!entry) return null;
      /* Expired? — remove and return null */
      const ttl = TTL[dataset] ?? (5 * 60 * 1000);
      if (Date.now() - entry.cachedAt > ttl) {
        this.clear(dataset);
        return null;
      }
      return entry.data;
    },

    set(dataset, data, version) {
      const store = this._read();
      store[dataset] = {
        data     : data,
        cachedAt : Date.now(),
        version  : version || null,
        stale    : false,
      };
      this._write(store);
    },

    markStale(dataset) {
      const store = this._read();
      if (store[dataset]) {
        store[dataset].stale = true;
        this._write(store);
      }
    },

    clear(dataset) {
      const store = this._read();
      delete store[dataset];
      this._write(store);
    },

    clearAll() {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
    },

    /** ms since dataset was cached, or Infinity */
    age(dataset) {
      try {
        const store = this._read();
        const entry = store[dataset];
        return entry ? Date.now() - entry.cachedAt : Infinity;
      } catch { return Infinity; }
    },

    /** Returns full entry metadata (without data) for status inspectors */
    meta(dataset) {
      try {
        const store = this._read();
        const entry = store[dataset];
        if (!entry) return null;
        const { data: _d, ...rest } = entry;
        const rowCount = Array.isArray(entry.data) ? entry.data.length : (entry.data ? 1 : 0);
        return { ...rest, rowCount };
      } catch { return null; }
    },

    /** All dataset keys currently in cache */
    keys() {
      return Object.keys(this._read());
    },
  };

  /* ═══ AUTH PRE-FLIGHT ═══
     Every cache read and every API call runs this first.
     Returns credentials { sessionId, token } or throws. */
  function _requireAuth() {
    const creds = window.Auth.getCredentials();
    if (!creds) {
      /* Auth.signOut redirects — but call it so timers stop */
      window.Auth.signOut();
      throw new Error('[DataLayer] Unauthenticated — session invalid or expired');
    }
    return creds;
  }

  /* ═══ VERSION CHECK ═══ */
  async function _fetchServerVersions() {
    const creds = _requireAuth();
    const url = `${API_BASE}?type=getVersions&sessionId=${encodeURIComponent(creds.sessionId)}&token=${encodeURIComponent(creds.token)}&t=${Date.now()}`;
    try {
      const res  = await fetch(url, { cache: 'no-store' });
      const data = await res.json();
      if (data && typeof data === 'object' && !data.error) {
        _serverVersions = data;   // { employees: 'v12', bikes: 'v8', ... }
      }
    } catch (e) {
      console.warn('[DataLayer] getVersions failed:', e.message);
    }
    return _serverVersions;
  }

  function _localVersion(dataset) {
    try {
      const store = Cache._read();
      return store[dataset]?.version || null;
    } catch { return null; }
  }

  /** True if server version matches local — skip download */
  function _versionMatch(dataset) {
    const local  = _localVersion(dataset);
    const server = _serverVersions[dataset];
    if (!local || !server) return false;   // unknown — must download
    return local === server;
  }

  /* ═══ CORE FETCH ═══ */
  async function _fetchDataset(dataset, { force = false } = {}) {

    /* 1. Auth gate */
    const creds = _requireAuth();

    /* 2. Cache hit (unless forced) */
    if (!force) {
      const cached = Cache.get(dataset);
      if (cached) return cached;
    }

    /* 3. In-flight dedup */
    if (_inFlight[dataset]) return _inFlight[dataset];

    /* 4. Version check — if server version unchanged, skip download */
    if (!force && Object.keys(_serverVersions).length > 0 && _versionMatch(dataset)) {
      /* Extend cache TTL using existing data */
      const store = Cache._read();
      if (store[dataset]) {
        store[dataset].cachedAt = Date.now();   // reset age
        Cache._write(store);
        return store[dataset].data;
      }
    }

    /* 5. Real network request */
    const promise = (async () => {
      const url = `${API_BASE}?type=${encodeURIComponent(dataset)}&sessionId=${encodeURIComponent(creds.sessionId)}&token=${encodeURIComponent(creds.token)}&t=${Date.now()}`;
      const res  = await fetch(url, { cache: 'no-store' });
      const raw  = await res.json();

      /* Server rejects session mid-flight */
      if (raw && raw.error === 'unauthorized') {
        window.Auth.signOut();
        throw new Error('[DataLayer] Server rejected credentials for dataset: ' + dataset);
      }

      /* Normalise response shape */
      const rows = Array.isArray(raw)
        ? raw
        : (raw.data ?? raw.values ?? raw.rows ?? []);

      /* Strip header row if present */
      const clean =
        rows.length && Array.isArray(rows[0]) &&
        typeof rows[0][0] === 'string' && /timestamp|date|id/i.test(rows[0][0])
          ? rows.slice(1) : rows;

      /* Version from response envelope */
      const version = raw.version || _serverVersions[dataset] || null;

      Cache.set(dataset, clean, version);
      _broadcast(dataset);
      _scheduleRefresh(dataset);

      return clean;
    })();

    _inFlight[dataset] = promise;

    try {
      return await promise;
    } catch (e) {
      /* Offline / error — mark stale, keep old data, schedule retry */
      Cache.markStale(dataset);
      _scheduleRetry(dataset);
      window.dispatchEvent(new CustomEvent('ap:fetchError', { detail: { dataset, error: e } }));
      /* Return stale data if available so page doesn't break */
      const stale = Cache.get(dataset);
      if (stale) return stale;
      throw e;
    } finally {
      delete _inFlight[dataset];
    }
  }

  /* ═══ BROADCAST ═══ */
  function _broadcast(dataset) {
    const evtName = EVENTS[dataset] || ('ap:updated:' + dataset);
    window.dispatchEvent(new CustomEvent(evtName, { detail: { dataset } }));
    window.dispatchEvent(new CustomEvent('ap:fetched', { detail: { dataset } }));
  }

  /* ═══ AUTO-REFRESH TIMERS ═══ */
  function _scheduleRefresh(dataset) {
    if (_timers[dataset]) clearTimeout(_timers[dataset]);
    const ttl = TTL[dataset] ?? (5 * 60 * 1000);
    _timers[dataset] = setTimeout(async () => {
      /* Check auth before firing — user may have logged out */
      if (!await window.Auth.isAuthenticated()) return;
      try {
        /* Version check first — only download if changed */
        await _fetchServerVersions();
        if (!_versionMatch(dataset)) {
          await _fetchDataset(dataset, { force: true });
        } else {
          /* Same version — just extend cachedAt and reschedule */
          const store = Cache._read();
          if (store[dataset]) {
            store[dataset].cachedAt = Date.now();
            Cache._write(store);
          }
          _scheduleRefresh(dataset);   // reschedule without downloading
        }
      } catch (e) {
        console.warn('[DataLayer] Auto-refresh failed for', dataset, ':', e.message);
        _scheduleRetry(dataset);
      }
    }, ttl);
  }

  /** Schedule a retry after failure — shorter interval */
  function _scheduleRetry(dataset, delayMs = 60 * 1000) {
    if (_timers[dataset]) clearTimeout(_timers[dataset]);
    _timers[dataset] = setTimeout(async () => {
      if (!await window.Auth.isAuthenticated()) return;
      try { await _fetchDataset(dataset, { force: true }); }
      catch (e) { _scheduleRetry(dataset, Math.min(delayMs * 2, 10 * 60 * 1000)); } // exponential backoff, max 10 min
    }, delayMs);
  }

  function _stopAllTimers() {
    Object.keys(_timers).forEach(k => { clearTimeout(_timers[k]); delete _timers[k]; });
  }

  /* ═══ STATUS INSPECTOR ═══ */
  function _getCacheStatus() {
    const LABELS = {
      employees:'Employees', bikes:'Bikes', finance:'Finance',
      advances:'Advances', settings:'Settings',
      master:'Master Sheet', cioLog:'Check-In/Out Log', recovery:'Recovery',
    };
    const knownKeys = Object.keys(TTL);
    const cachedKeys = Cache.keys();
    const allKeys = [...new Set([...knownKeys, ...cachedKeys])];

    return allKeys.map(k => {
      const ageMs   = Cache.age(k);
      const ttl     = TTL[k] ?? (5 * 60 * 1000);
      const fresh   = ageMs < ttl;
      const meta    = Cache.meta(k);
      const hasData = meta ? meta.rowCount > 0 : false;

      let ageLabel = 'Not loaded';
      let lastSync = null;
      if (ageMs !== Infinity) {
        const s = Math.floor(ageMs / 1000);
        ageLabel = s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s/60)}m ago` : `${Math.floor(s/3600)}h ago`;
        const d  = new Date(Date.now() - ageMs);
        lastSync = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
                 + ', ' + d.toLocaleDateString([], { day:'2-digit', month:'short' });
      }

      const remaining = ageMs === Infinity ? 0 : Math.max(0, ttl - ageMs);
      const stale     = meta?.stale || false;

      return {
        key       : k,
        label     : LABELS[k] || k,
        ageMs,
        ageLabel,
        fresh,
        hasData,
        lastSync,
        ttlMs     : ttl,
        remaining,
        stale,
        version   : meta?.version || null,
        rowCount  : meta?.rowCount || 0,
      };
    });
  }

  /* ═══ AUTHENTICATED POST ═══ */
  async function _post(action, body = {}) {
    const creds = _requireAuth();
    const res   = await fetch(API_BASE, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        action,
        sessionId : creds.sessionId,
        token     : creds.token,
        ...body,
      }),
    });
    const result = await res.json();
    if (result.error === 'unauthorized') {
      window.Auth.signOut();
      throw new Error('[DataLayer] POST rejected — unauthorized');
    }
    if (result.success !== true && result.status !== 'ok') {
      throw new Error(result.error || 'Server error');
    }
    return result;
  }

  /* ═══ CACHE BAR RENDERER (shared across pages) ═══ */
  function _setCacheBar(state, ts) {
    const pill = document.getElementById('cache-pill');
    const tsEl = document.getElementById('cache-ts');
    if (!pill || !tsEl) return;

    if (state === 'loading') {
      pill.className = 'cache-pill syncing';
      pill.innerHTML = '<i class="ti ti-refresh" style="animation:spin 1s linear infinite;display:inline-block;"></i>';
      tsEl.textContent = 'Loading…';
    } else if (state === 'synced') {
      pill.className = 'cache-pill synced';
      pill.innerHTML = '<i class="ti ti-circle-check"></i>';
      const d = new Date(ts || Date.now());
      tsEl.textContent = `${d.toLocaleDateString([], { day:'2-digit', month:'short' })}, `
                       + `${d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
    } else if (state === 'stale') {
      pill.className = 'cache-pill stale';
      pill.innerHTML = '<i class="ti ti-alert-triangle"></i>';
      tsEl.textContent = 'Stale — retrying…';
    } else {
      pill.className = 'cache-pill err';
      pill.innerHTML = '<i class="ti ti-alert-circle"></i>';
      tsEl.textContent = 'Fetch error';
    }
  }

  /* ─── Expose internals for DataLayer ─── */
  return {
    fetch           : _fetchDataset,
    post            : _post,
    cache           : Cache,
    getCacheStatus  : _getCacheStatus,
    setCacheBar     : _setCacheBar,
    stopAllTimers   : _stopAllTimers,
    fetchVersions   : _fetchServerVersions,
    TTL,
    EVENTS,
  };

})();


/* ═══════════════════════════════════════════════════════════════
   2. PUBLIC API — window.DataLayer
      Pages call ONLY these methods. No direct API calls from pages.
═══════════════════════════════════════════════════════════════ */
window.DataLayer = {

  /* ── Typed getters ── */
  async getEmployees(opts) { _DL.setCacheBar('loading'); try { const d = await _DL.fetch('employees', opts); _DL.setCacheBar('synced', Date.now()); return d; } catch(e) { _DL.setCacheBar('stale'); throw e; } },
  async getBikes    (opts) { _DL.setCacheBar('loading'); try { const d = await _DL.fetch('bikes',     opts); _DL.setCacheBar('synced', Date.now()); return d; } catch(e) { _DL.setCacheBar('stale'); throw e; } },
  async getFinance  (opts) { _DL.setCacheBar('loading'); try { const d = await _DL.fetch('finance',   opts); _DL.setCacheBar('synced', Date.now()); return d; } catch(e) { _DL.setCacheBar('stale'); throw e; } },
  async getAdvances (opts) { _DL.setCacheBar('loading'); try { const d = await _DL.fetch('advances',  opts); _DL.setCacheBar('synced', Date.now()); return d; } catch(e) { _DL.setCacheBar('stale'); throw e; } },
  async getSettings (opts) { _DL.setCacheBar('loading'); try { const d = await _DL.fetch('settings',  opts); _DL.setCacheBar('synced', Date.now()); return d; } catch(e) { _DL.setCacheBar('stale'); throw e; } },

  /* ── Legacy compat (allBike, inOut etc. still use these) ── */
  async loadBikes    (opts) { return this.getBikes(opts);     },
  async loadEmployees(opts) { return this.getEmployees(opts); },
  async loadMaster   (opts) { return _DL.fetch('master',   opts); },
  async loadCioLog   (opts) { return _DL.fetch('cioLog',   opts); },
  async loadRecovery (opts) { return _DL.fetch('recovery', opts); },

  /** Force-refresh a specific dataset (bypasses cache + version check) */
  async forceRefresh(dataset) {
    _DL.cache.clear(dataset);
    return _DL.fetch(dataset, { force: true });
  },

  /** POST wrapper — all pages use this instead of raw fetch */
  async post(action, body) {
    return _DL.post(action, body);
  },

  /** Warm all datasets in parallel after login */
  async warmCache() {
    const types = ['employees', 'bikes', 'finance', 'advances', 'settings', 'master', 'cioLog'];
    await Promise.allSettled(types.map(t => _DL.fetch(t)));
  },

  /** Fetch and store server versions, return them */
  async checkVersions() {
    return _DL.fetchVersions();
  },

  /** Cache status array — used by index.html cache panel */
  getCacheStatus() {
    return _DL.getCacheStatus();
  },

  /** Stop all refresh timers (called by Auth.signOut) */
  stopAllTimers() {
    _DL.stopAllTimers();
  },

  /** Shared cache-bar renderer for page-level status bars */
  setCacheBar(state, ts) {
    _DL.setCacheBar(state, ts);
  },

  /** Direct cache access for advanced use */
  cache: _DL.cache,

  /** TTL map — used by cache panel in index.html */
  TTL: _DL.TTL,
};


/* ═══════════════════════════════════════════════════════════════
   3. LEGACY SHIM — window.AdminPro
      Keeps existing pages (allBike, allEmp, penReq…) working
      without modification. Routes through DataLayer internally.
═══════════════════════════════════════════════════════════════ */
window.AdminPro = window.AdminPro || {};

Object.assign(window.AdminPro, {
  API_BASE: 'https://script.google.com/macros/s/AKfycbxLizuKCu3XP9Q1fhiXkRskhnBus84Obvu00jIVBMuLYkS2yp9qf7EaLHOS7j4nPuQfFw/exec',

  api: {
    get : (type, extra = {}) => {
      /* Legacy callers get a URL — but DataLayer intercepts real calls */
      const creds  = window.Auth.getCredentials() || {};
      const params = new URLSearchParams({ type, ...creds, t: Date.now(), ...extra });
      return `https://script.google.com/macros/s/AKfycbxLizuKCu3XP9Q1fhiXkRskhnBus84Obvu00jIVBMuLYkS2yp9qf7EaLHOS7j4nPuQfFw/exec?${params}`;
    },
    post: () => 'https://script.google.com/macros/s/AKfycbxLizuKCu3XP9Q1fhiXkRskhnBus84Obvu00jIVBMuLYkS2yp9qf7EaLHOS7j4nPuQfFw/exec',
  },

  cache        : _DL.cache,
  fetch        : (type, opts) => _DL.fetch(type, opts),
  post         : (action, body) => _DL.post(action, body),
  forceRefresh : (type) => window.DataLayer.forceRefresh(type),
  warmCache    : () => window.DataLayer.warmCache(),
  getCacheStatus: () => _DL.getCacheStatus(),
  setCacheBar  : (s, ts) => _DL.setCacheBar(s, ts),
  stopAllTimers: () => _DL.stopAllTimers(),
  TTL          : _DL.TTL,

  loadBikes     : (opts) => window.DataLayer.getBikes(opts),
  loadEmployees : (opts) => window.DataLayer.getEmployees(opts),
  loadMaster    : (opts) => window.DataLayer.loadMaster(opts),
  loadCioLog    : (opts) => window.DataLayer.loadCioLog(opts),
});

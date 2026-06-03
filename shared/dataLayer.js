/* ═══════════════════════════════════════════════════════════════
   dataLayer.js — AdminPro UAE
   Centralized API, Cache, and Data-Fetching Architecture
   Include AFTER auth.js on every page:
     <script src="shared/auth.js"></script>
     <script src="shared/dataLayer.js"></script>
═══════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────
   1. SINGLE SOURCE OF TRUTH — API URL
   All pages reference window.AdminPro.api.*
   instead of their own local SHEET_URL / GAS_URL / MASTER_API.
───────────────────────────────────────── */
const AdminPro = window.AdminPro || {};
window.AdminPro = AdminPro;

AdminPro.API_BASE =
  typeof API_BASE !== 'undefined'
    ? API_BASE                        // auth.js already defined it
    : 'https://script.google.com/macros/s/AKfycbxLizuKCu3XP9Q1fhiXkRskhnBus84Obvu00jIVBMuLYkS2yp9qf7EaLHOS7j4nPuQfFw/exec';

/* Typed endpoint builders — use these everywhere */
AdminPro.api = {
  get : (type, extra = {}) => {
    const params = new URLSearchParams({ type, t: Date.now(), ...extra });
    return `${AdminPro.API_BASE}?${params}`;
  },
  post: () => AdminPro.API_BASE,
};


/* ─────────────────────────────────────────
   2. CACHE ENGINE
   Replaces the per-page bikeCacheSave/Load/Clear, empCacheSave …
   All pages share one coherent implementation.

   API:
     AdminPro.cache.get(key)          → data | null
     AdminPro.cache.set(key, data)
     AdminPro.cache.clear(key)
     AdminPro.cache.clearAll()
     AdminPro.cache.age(key)          → ms since saved | Infinity
───────────────────────────────────────── */
AdminPro.cache = (() => {
  /* Per-key TTLs in milliseconds.
     Override before calling load() if you need a custom TTL. */
  const TTL = {
    bike        : 5  * 60 * 1000,   // 5 min
    employee    : 6  * 60 * 60 * 1000,  // 6 hr
    master      : 5  * 60 * 1000,
    cioLog      : 5  * 60 * 1000,
    approvedSheet: 3 * 60 * 1000,
    recovery    : 6  * 60 * 60 * 1000,
  };

  const KEY_PREFIX = 'ap2_';        // bump suffix to bust all caches on deploy

  function storageKey(name) { return KEY_PREFIX + name; }

  function get(name) {
    try {
      const raw = localStorage.getItem(storageKey(name));
      if (!raw) return null;
      const { ts, data } = JSON.parse(raw);
      const ttl = TTL[name] ?? (5 * 60 * 1000);
      if (Date.now() - ts > ttl) { localStorage.removeItem(storageKey(name)); return null; }
      return data;
    } catch { return null; }
  }

  function set(name, data) {
    try { localStorage.setItem(storageKey(name), JSON.stringify({ ts: Date.now(), data })); }
    catch (e) { console.warn('AdminPro.cache.set failed:', e); }
  }

  function clear(name) {
    try { localStorage.removeItem(storageKey(name)); } catch {}
  }

  function clearAll() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(KEY_PREFIX))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
  }

  function age(name) {
    try {
      const raw = localStorage.getItem(storageKey(name));
      if (!raw) return Infinity;
      const { ts } = JSON.parse(raw);
      return Date.now() - ts;
    } catch { return Infinity; }
  }

  return { get, set, clear, clearAll, age, TTL };
})();


/* ─────────────────────────────────────────
   3. IN-FLIGHT REQUEST DEDUPLICATION
   If two components call fetch('employee') at the same time,
   only ONE real network request is made; both await the same Promise.
───────────────────────────────────────── */
AdminPro._inFlight = {};

/* ─────────────────────────────────────────
   4. GENERIC FETCH HELPER
   AdminPro.fetch(type, options?)
     → Promise<any[]>   (always resolves to an array)

   options {
     force   : bool   — skip cache (default false)
     extra   : {}     — extra GET params
   }

   Fires a custom Event 'ap:fetched' on window when done.
   Fires 'ap:fetchError' on failure.
───────────────────────────────────────── */
AdminPro.fetch = async function(type, { force = false, extra = {} } = {}) {
  /* 1. Try cache first */
  if (!force) {
    const cached = AdminPro.cache.get(type);
    if (cached) return cached;
  }

  /* 2. Deduplicate in-flight requests */
  if (AdminPro._inFlight[type]) return AdminPro._inFlight[type];

  /* 3. Real network request */
  const promise = (async () => {
    const url = AdminPro.api.get(type, extra);
    const res  = await fetch(url, { cache: 'no-store' });
    const raw  = await res.json();

    /* Normalise: Apps Script can return array, {data:[]}, {values:[]}, {rows:[]} */
    const rows = Array.isArray(raw)
      ? raw
      : (raw.data ?? raw.values ?? raw.rows ?? []);

    /* Strip header row if present */
    const clean =
      rows.length && Array.isArray(rows[0]) &&
      typeof rows[0][0] === 'string' && /timestamp|date|id/i.test(rows[0][0])
        ? rows.slice(1)
        : rows;

    AdminPro.cache.set(type, clean);
    window.dispatchEvent(new CustomEvent('ap:fetched', { detail: { type, rows: clean } }));
    return clean;
  })();

  AdminPro._inFlight[type] = promise;

  try {
    const result = await promise;
    return result;
  } catch(e) {
    window.dispatchEvent(new CustomEvent('ap:fetchError', { detail: { type, error: e } }));
    throw e;
  } finally {
    delete AdminPro._inFlight[type];
  }
};


/* ─────────────────────────────────────────
   5. POST HELPER
   AdminPro.post(action, body)
     → Promise<object>

   Replaces the raw fetch(SHEET_URL, {method:'POST',...}) calls
   scattered across allBike, allEmp, inOut, etc.
───────────────────────────────────────── */
AdminPro.post = async function(action, body = {}) {
  const res = await fetch(AdminPro.api.post(), {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ action, ...body }),
  });
  const result = await res.json();
  if (result.success !== true && result.status !== 'ok') {
    throw new Error(result.error || 'Server error');
  }
  return result;
};


/* ─────────────────────────────────────────
   6. CACHE-BAR UTILITY
   Shared renderer — every page has the same cache-bar HTML;
   call AdminPro.setCacheBar(state, ts?) to update it.

   state: 'loading' | 'synced' | 'error'
   ts   : timestamp ms (for 'synced')
───────────────────────────────────────── */
AdminPro.setCacheBar = function(state, ts) {
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
  } else {
    pill.className = 'cache-pill err';
    pill.innerHTML = '<i class="ti ti-alert-circle"></i>';
    tsEl.textContent = 'Fetch error';
  }
};


/* ─────────────────────────────────────────
   7. TYPED DATA LOADERS
   High-level helpers pages can call directly.
   Each returns a normalised array and updates the cache.

   Usage:
     const bikes = await AdminPro.loadBikes();
     const emps  = await AdminPro.loadEmployees();
───────────────────────────────────────── */

/* Bike column map (0-based, matches your sheet) */
const _BIKE_COL = {
  timestamp:0, bikeId:1, plate:2, chassis:3, make:4, model:5,
  emirate:6, mulkiyaExp:7, passingExp:8, insExp:9, status:10,
};

function _normBike(r, i) {
  if (!r) return null;
  if (Array.isArray(r)) {
    if (typeof r[_BIKE_COL.plate] === 'string' && /plate/i.test(r[_BIKE_COL.plate])) return null;
    const plate = (r[_BIKE_COL.plate] || '').toString().trim();
    if (!plate) return null;
    return {
      _rowIndex  : i + 2,
      timestamp  : (r[_BIKE_COL.timestamp]  || '').toString(),
      bikeId     : (r[_BIKE_COL.bikeId]     || String(i + 1)).toString(),
      plate,
      chassis    : (r[_BIKE_COL.chassis]    || '').toString(),
      make       : (r[_BIKE_COL.make]       || '—').toString(),
      model      : (r[_BIKE_COL.model]      || '—').toString(),
      emirate    : (r[_BIKE_COL.emirate]    || '').toString(),
      mulkiyaExp : (r[_BIKE_COL.mulkiyaExp] || '').toString(),
      passingExp : (r[_BIKE_COL.passingExp] || '').toString(),
      insExp     : (r[_BIKE_COL.insExp]     || '').toString(),
      status     : (r[_BIKE_COL.status]     || 'active').toString().toLowerCase(),
    };
  }
  /* Object rows (CSV upload path) */
  const plate = (r.plate || r.plateNumber || r['Plate Number'] || '').toString().trim();
  if (!plate) return null;
  return {
    _rowIndex  : r._rowIndex || (i + 2),
    timestamp  : (r.timestamp  || r.Timestamp                || '').toString(),
    bikeId     : (r.bikeId     || r['Bike ID']               || String(i + 1)).toString(),
    plate,
    chassis    : (r.chassis    || r['Chassis Number']        || '').toString(),
    make       : (r.make       || r.Make                     || '—').toString(),
    model      : (r.model      || r.Model                    || '—').toString(),
    emirate    : (r.emirate    || r.Emirate                  || '').toString(),
    mulkiyaExp : (r.mulkiyaExp || r['Mulkiya Expiry']        || '').toString(),
    passingExp : (r.passingExp || r['Passing Expiry']        || '').toString(),
    insExp     : (r.insExp     || r['Insurance Expiry']      || '').toString(),
    status     : (r.status     || r.Status                   || 'active').toString().toLowerCase(),
  };
}

AdminPro.loadBikes = async function({ force = false } = {}) {
  AdminPro.setCacheBar('loading');
  try {
    const rows  = await AdminPro.fetch('bike', { force });
    const bikes = rows.map((r, i) => _normBike(r, i)).filter(Boolean);
    AdminPro.setCacheBar('synced', Date.now());
    return bikes;
  } catch(e) {
    AdminPro.setCacheBar('error');
    throw e;
  }
};

AdminPro.loadEmployees = async function({ force = false } = {}) {
  AdminPro.setCacheBar('loading');
  try {
    const rows = await AdminPro.fetch('employee', { force });
    AdminPro.setCacheBar('synced', Date.now());
    return rows;                    // allEmp.html does its own normalisation
  } catch(e) {
    AdminPro.setCacheBar('error');
    throw e;
  }
};

AdminPro.loadMaster = async function({ force = false } = {}) {
  return AdminPro.fetch('master', { force });
};

AdminPro.loadCioLog = async function({ force = false } = {}) {
  return AdminPro.fetch('cioLog', { force });
};


/* ─────────────────────────────────────────
   8. CONVENIENCE: force-refresh shorthand
   Call AdminPro.forceRefresh('bike') from any page's
   "Refresh" button, then re-run your own renderAll().
───────────────────────────────────────── */
AdminPro.forceRefresh = async function(type) {
  AdminPro.cache.clear(type);
  return AdminPro.fetch(type, { force: true });
};
/* ─────────────────────────────────────────
   9. POST-LOGIN CACHE WARM-UP
   Call immediately after login succeeds (before redirect).
   Fires background fetches for all key datasets so cache
   is hot when the dashboard loads — user never waits.
   
   Usage in login.html (after sessionStorage.setItem):
     await AdminPro.warmCache();
───────────────────────────────────────── */
AdminPro.warmCache = async function() {
  const types = ['bike', 'employee', 'master', 'cioLog'];
  // Fire all in parallel — don't await individually so one failure
  // doesn't block the others. Errors are silently swallowed here;
  // individual pages will retry on load.
  await Promise.allSettled(
    types.map(t => AdminPro.fetch(t, { force: false }))
  );
};

/* ─────────────────────────────────────────
   10. CACHE STATUS INSPECTOR
   Returns an array of { key, age, ageLabel, fresh }
   for every known cache key — used by the topbar
   cache-reload button tooltip in index.html.
───────────────────────────────────────── */
AdminPro.getCacheStatus = function() {
  const keys = ['bike','employee','master','cioLog','approvedSheet','recovery'];
  const labels = {
    bike:'Bikes', employee:'Employees', master:'Master Data',
    cioLog:'Check-In/Out Log', approvedSheet:'Approved Sheet', recovery:'Recovery',
  };
  return keys.map(k => {
    const ageMs  = AdminPro.cache.age(k);          // ms or Infinity
    const ttl    = AdminPro.cache.TTL[k] ?? 300000;
    const fresh  = ageMs < ttl;
    let ageLabel = 'Not loaded';
    if (ageMs !== Infinity) {
      const s = Math.floor(ageMs / 1000);
      ageLabel = s < 60  ? `${s}s ago`
               : s < 3600 ? `${Math.floor(s/60)}m ago`
               : `${Math.floor(s/3600)}h ago`;
    }
    return { key: k, label: labels[k], ageMs, ageLabel, fresh };
  });
};

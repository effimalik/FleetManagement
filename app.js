/* ══════════════════════════════════════════════
   UAE HR & Fleet Management Dashboard
   app.js — Main application logic
   ══════════════════════════════════════════════ */

'use strict';

/* ═══════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════ */
const EMP_DOCS  = ['pic','labour','visa','license','insurance','eid-doc'];
const BIKE_DOCS = ['mulkiya','insurance','licence','eid','purchase','inspection','clearance','photo'];

// ── Google Sheet connection ──────────────────────────────────────────────────
// Replace this URL with your deployed Google Apps Script Web App URL.
// The script should return a JSON array of employee objects (or rows).

const EMP_SHEET_URL  = 'https://script.google.com/macros/s/AKfycbwzZ5YA9aJ_nwOPLL0uP8GlonjZ29ASKoBuXNDeIhtPg8D9Rw6jYE4RX5Zg6ky_yR24qg/exec?type=employee';

// Replace this URL with your deployed Google Apps Script Web App URL for bikes.
// The script should return a JSON array of bike rows (array-of-arrays or array-of-objects).
const BIKE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbwzZ5YA9aJ_nwOPLL0uP8GlonjZ29ASKoBuXNDeIhtPg8D9Rw6jYE4RX5Zg6ky_yR24qg/exec?type=bike';

const AV_BG = ['#1f6feb20','#1a7f3720','#9a6700206','#6e40c920','#bf454220','#0e7490206'];
const AV_FG = ['#58a6ff','#3fb950','#e3b341','#d2a8ff','#ffa198','#22d3ee'];
const AV_BG2= ['rgba(31,111,235,.2)','rgba(26,127,55,.2)','rgba(154,103,0,.2)','rgba(110,64,201,.2)','rgba(191,69,66,.2)','rgba(14,116,144,.2)'];

const WARN_DAYS = 60; // days before expiry to mark as "expiring"

/* ═══════════════════════════════════════════════
   SAMPLE DATA
   ═══════════════════════════════════════════════ */
// Employees are loaded from Google Sheet on init (see loadEmployees()).
// The array below starts empty — data is fetched and replaces it at runtime.
let employees = [];

// Bikes are loaded from Google Sheet on init (see loadBikes()).
// The array below starts empty — data is fetched and replaces it at runtime.
let bikes = [];

let nextEmpId  = 6;
let nextBikeId = 5;
let editEmpId  = null;
let editBikeId = null;
let empPending  = {};
let bikePending = {};
let currentUploadType = null;
let currentUploadDoc  = null;

/* ═══════════════════════════════════════════════
   UTILITY
   ═══════════════════════════════════════════════ */
function today() { return new Date(); }

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  return Math.ceil((new Date(dateStr) - today()) / 86400000);
}

function isExpired(dateStr)  { return daysUntil(dateStr) < 0; }
function isExpiring(dateStr) { const d = daysUntil(dateStr); return d >= 0 && d <= WARN_DAYS; }

function dateColor(dateStr) {
  if (!dateStr) return '';
  if (isExpired(dateStr))  return 'color:var(--red);font-weight:600;';
  if (isExpiring(dateStr)) return 'color:var(--amber);font-weight:500;';
  return 'color:var(--teal);';
}

function empStatus(e) {
  if (isExpired(e.eidExp) || isExpired(e.visaExp)) return 'expired';
  if (isExpiring(e.eidExp) || isExpiring(e.visaExp)) return 'expiring';
  return 'active';
}

function bikeStatus(b) {
  if (isExpired(b.mulkiyaExp) || isExpired(b.insExp)) return 'expired';
  if (isExpiring(b.mulkiyaExp) || isExpiring(b.insExp)) return 'expiring';
  return 'active';
}

function av(name, i) {
  const idx = i % AV_FG.length;
  const initials = name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
  return `<div class="avatar" style="background:${AV_BG2[idx]};color:${AV_FG[idx]};">${initials}</div>`;
}

function bikeAv(i) {
  const idx = i % AV_FG.length;
  return `<div class="bike-icon" style="background:${AV_BG2[idx]};color:${AV_FG[idx]};"><i class="ti ti-motorbike"></i></div>`;
}

function dotState(docsObj, key) {
  const d = docsObj[key];
  if (!d) return 'miss';
  if (d.expiry) {
    if (isExpired(d.expiry))  return 'expired';
    if (isExpiring(d.expiry)) return 'expiring';
  }
  return 'ok';
}

function dots(docsObj, keys, entityType, entityId) {
  return keys.map(k => {
    const state = dotState(docsObj, k);
    return `<div class="dot ${state}" title="${k}" onclick="openDocModal('${entityType}',${entityId},'${k}')"></div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════
   LOAD EMPLOYEES FROM GOOGLE SHEET
   ═══════════════════════════════════════════════ */

/**
 * Fetches employee rows from the Google Apps Script web-app.
 * Expected sheet columns (case-insensitive, flexible):
 *   ID | Full Name | EID Number | Date of Birth | EID Expiry |
 *   Mobile UAE | Mobile Pakistan | Company | Reference | Visa Expiry |
 *   pic | labour | visa | license | insurance | eid-doc
 *
 * Each column can be present or absent; missing values default to '' / false.
 * Call this once on page load (done in DOMContentLoaded below).
 */
/**
 * Computes expiry status and CSS color from a date string.
 * Returns an object: { date, status, color }
 * status: 'valid' | 'expiring_soon' | 'expired' | 'not_available'
 * color:  'green' | 'pink' | 'red' | 'gray'
 */
function computeExpiry(dateStr) {
  if (!dateStr || String(dateStr).trim() === '') {
    return { date: null, status: 'not_available', color: 'gray' };
  }
  const d = String(dateStr).trim();
  if (isExpired(d))  return { date: d, status: 'expired',       color: 'red'   };
  if (isExpiring(d)) return { date: d, status: 'expiring_soon', color: 'pink'  };
  return               { date: d, status: 'valid',           color: 'green' };
}

/**
 * Normalises one raw row coming from the Google Sheet.
 * Handles two formats automatically:
 *
 *  A) Object (old format):
 *     { id, name, eid, dob, mobile, emergency, reference, timestamp,
 *       hrStatus, checkoutException, expiry:{ eid:{date,status,color}, ... } }
 *
 *  B) Flat array (new format — positional):
 *     [id, name, eid, dob, mobile, emergency, reference, timestamp,
 *      hrStatus, checkoutException,
 *      eid_expiry_date, license_expiry_date, labour_expiry_date, insurance_expiry_date]
 */
function normaliseRow(r, i) {
  if (!r) return null;

  /* ── Array (new format) ── */
  if (Array.isArray(r)) {
    const [
      id, name, eid, dob, mobile, emergency, reference, timestamp,
      hrStatus, checkoutException,
      eidDate, licenseDate, labourDate, insuranceDate
    ] = r;

    /* Guard: skip rows where both id and name are empty/undefined */
    if ((id === undefined || id === null || id === '') &&
        (name === undefined || name === null || name === '')) return null;

    return {
      id:                (id !== undefined && id !== null && id !== '') ? id : (i + 1),
      name:              (name !== undefined && name !== null) ? String(name) : '',
      eid:               (eid  !== undefined && eid  !== null) ? String(eid)  : '',
      dob:               dob        ? String(dob)       : '',
      mobile:            mobile     ? String(mobile)    : '',
      emergency:         emergency  ? String(emergency) : '',
      reference:         reference  ? String(reference) : '',
      timestamp:         timestamp  ? String(timestamp) : '',
      hrStatus:          hrStatus   ? String(hrStatus)  : '',
      checkoutException: checkoutException ? String(checkoutException) : '',
      expiry: {
        eid:      computeExpiry(eidDate),
        license:  computeExpiry(licenseDate),
        labour:   computeExpiry(labourDate),
        insurance:computeExpiry(insuranceDate),
      }
    };
  }

  /* ── Object (old format) ── */
  /* If expiry sub-objects already have status, keep them.
     If they only have a date string, recompute status/color so the
     frontend always gets consistent { date, status, color } objects. */
  const rehydrate = (expObj) => {
    if (!expObj || typeof expObj !== 'object') return computeExpiry(null);
    if (expObj.status) return expObj;               // already complete
    return computeExpiry(expObj.date || null);       // recompute from date
  };

  const rawExpiry = r.expiry || {};
  return {
    id:                r.id   || (i + 1),
    name:              r.name || '',
    eid:               r.eid  || '',
    dob:               r.dob  || '',
    mobile:            r.mobile     || '',
    emergency:         r.emergency  || '',
    reference:         r.reference  || '',
    timestamp:         r.timestamp  || '',
    hrStatus:          r.hrStatus   || '',
    checkoutException: r.checkoutException || '',
    expiry: {
      eid:      rehydrate(rawExpiry.eid),
      license:  rehydrate(rawExpiry.license),
      labour:   rehydrate(rawExpiry.labour),
      insurance:rehydrate(rawExpiry.insurance),
    }
  };
}

/* ── localStorage cache helpers ── */
const EMP_CACHE_KEY = 'emp_cache_v1';
const EMP_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function empCacheSave(rows) {
  try {
    localStorage.setItem(EMP_CACHE_KEY, JSON.stringify({ ts: Date.now(), rows }));
  } catch(e) { /* storage full — skip silently */ }
}

function empCacheLoad() {
  try {
    const raw = localStorage.getItem(EMP_CACHE_KEY);
    if (!raw) return null;
    const { ts, rows } = JSON.parse(raw);
    if (Date.now() - ts > EMP_CACHE_TTL) return null; // stale
    return rows;
  } catch(e) { return null; }
}

function empCacheClear() {
  localStorage.removeItem(EMP_CACHE_KEY);
}

function showCacheBanner(show) {
  let banner = document.getElementById('emp-cache-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'emp-cache-banner';
    banner.style.cssText = 'font-size:11px;color:var(--text3);padding:4px 12px;text-align:right;';
    const tbl = document.getElementById('emp-tbody')?.closest('table');
    tbl?.parentElement?.insertBefore(banner, tbl);
  }
  if (show) {
    banner.innerHTML = `<i class="ti ti-refresh" style="animation:spin 1s linear infinite;display:inline-block;"></i> Refreshing data in background…`;
  } else {
    const now = new Date().toLocaleTimeString();
    banner.innerHTML = `Last synced: ${now} &nbsp;·&nbsp; <a href="#" onclick="empCacheClear();loadEmployees();return false;" style="color:var(--text3);">Force refresh</a>`;
  }
}

function parseRows(raw) {
  let rows = Array.isArray(raw)
    ? raw
    : Array.isArray(raw.data)   ? raw.data
    : Array.isArray(raw.values) ? raw.values
    : Array.isArray(raw.rows)   ? raw.rows
    : [];

  // Strip a header row only if the first cell looks like a column label
  // (a short word like "id", "name", "timestamp" — NOT a date like "2025-01-15")
  const HEADER_RE = /^[a-z_\s]+$/i;
  const DATE_RE   = /^\d{4}-\d{2}-\d{2}/;
  if (
    rows.length > 0 &&
    Array.isArray(rows[0]) &&
    typeof rows[0][0] === 'string' &&
    HEADER_RE.test(rows[0][0]) &&
    !DATE_RE.test(rows[0][0])
  ) {
    rows = rows.slice(1);
  }
  return rows;
}

async function loadEmployees() {
  const tbody = document.getElementById('emp-tbody');

  /* ── Step 1: show cached data immediately if available ── */
  const cached = empCacheLoad();
  if (cached && cached.length) {
    employees = cached.map((r, i) => normaliseRow(r, i)).filter(Boolean);
    renderEmpTable(employees);
    updateBadges();
    showCacheBanner(true); // show "refreshing" notice
  } else {
    tbody.innerHTML = `
      <tr><td colspan="9" style="text-align:center;padding:30px;">
        <i class="ti ti-loader" style="animation:spin 1s linear infinite;display:inline-block;font-size:22px;color:var(--text3);"></i>
        <div style="margin-top:8px;color:var(--text3);font-size:13px;">Loading employees…</div>
      </td></tr>`;
  }

  /* ── Step 2: fetch fresh data in background ── */
  try {
    const res = await fetch(EMP_SHEET_URL + '&nocache=' + Date.now());
    const raw = await res.json();
    const rows = parseRows(raw);

    empCacheSave(rows); // save raw rows for next load
    employees = rows.map((r, i) => normaliseRow(r, i)).filter(Boolean);
    renderEmpTable(employees);
    updateBadges();
    showCacheBanner(false);

  } catch (err) {
    console.error('loadEmployees error:', err);
    if (!cached || !cached.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--red);">
        Error loading data — check console for details.
      </td></tr>`;
    } else {
      showCacheBanner(false); // still show cached data, note the time
    }
  }
}



function getColor(status) {
  if (status === 'valid') return 'green';
  if (status === 'expiring_soon') return 'pink';
  if (status === 'expired') return 'red';
  return 'gray';
}

/* ═══════════════════════════════════════════════
   LOAD BIKES FROM GOOGLE SHEET
   ═══════════════════════════════════════════════ */

/* ── localStorage cache helpers (mirrors employee pattern) ── */
const BIKE_CACHE_KEY = 'bike_cache_v1';
const BIKE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function bikeCacheSave(rows) {
  try {
    localStorage.setItem(BIKE_CACHE_KEY, JSON.stringify({ ts: Date.now(), rows }));
  } catch(e) { /* storage full — skip silently */ }
}

function bikeCacheLoad() {
  try {
    const raw = localStorage.getItem(BIKE_CACHE_KEY);
    if (!raw) return null;
    const { ts, rows } = JSON.parse(raw);
    if (Date.now() - ts > BIKE_CACHE_TTL) return null; // stale
    return rows;
  } catch(e) { return null; }
}

function bikeCacheClear() {
  localStorage.removeItem(BIKE_CACHE_KEY);
}

function showBikeCacheBanner(show) {
  let banner = document.getElementById('bike-cache-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'bike-cache-banner';
    banner.style.cssText = 'font-size:11px;color:var(--text3);padding:4px 12px;text-align:right;';
    const tbl = document.getElementById('bike-tbody')?.closest('table');
    tbl?.parentElement?.insertBefore(banner, tbl);
  }
  if (show) {
    banner.innerHTML = `<i class="ti ti-refresh" style="animation:spin 1s linear infinite;display:inline-block;"></i> Refreshing data in background…`;
  } else {
    const now = new Date().toLocaleTimeString();
    banner.innerHTML = `Last synced: ${now} &nbsp;·&nbsp; <a href="#" onclick="bikeCacheClear();loadBikes();return false;" style="color:var(--text3);">Force refresh</a>`;
  }
}

/**
 * Normalises one raw bike row coming from the Google Sheet.
 * Handles two formats:
 *
 *  A) Array (positional):
 *     [id, plate, chassis, make, model, year, colour, cc, emirate,
 *      owner, ownerEid, licence, licCat, mobile, ref,
 *      mulkiyaExp, insExp, licExp, fine,
 *      mulkiya, insurance, licence_doc, eid, purchase, inspection, clearance, photo]
 *
 *  B) Object: fields already named; merged directly.
 */
function normaliseBikeRow(r, i) {
  if (!r) return null;

  /* ── Array (positional) — matches Apps Script getBikes() output:
     [timestamp, bikeId, plate, chassis, make, model, emirate,
      mulkiyaExp, passingExp, insExp]
  ── */
  if (Array.isArray(r)) {
    const [
      timestamp, id, plate, chassis, make, model, emirate,
      mulkiyaExp, licExp, insExp
    ] = r;

    /* Skip blank rows */
    if ((id === undefined || id === null || id === '') &&
        (plate === undefined || plate === null || plate === '')) return null;

    return {
      id:         id        ? String(id)        : (i + 1),
      plate:      plate     ? String(plate)     : '',
      chassis:    chassis   ? String(chassis)   : '',
      make:       make      ? String(make)      : '—',
      model:      model     ? String(model)     : '—',
      year:       null,
      colour:     '',
      cc:         null,
      emirate:    emirate   ? String(emirate)   : '',
      owner:      '',
      ownerEid:   '',
      licence:    '',
      licCat:     '',
      mobile:     '',
      ref:        '',
      mulkiyaExp: mulkiyaExp ? String(mulkiyaExp) : '',
      insExp:     insExp     ? String(insExp)     : '',
      licExp:     licExp     ? String(licExp)     : '',
      fine:       0,
      timestamp:  timestamp  ? String(timestamp)  : '',
      docs: {
        mulkiya:    !!mulkiyaExp,
        insurance:  !!insExp,
        licence:    !!licExp,
        eid:        false,
        purchase:   false,
        inspection: false,
        clearance:  false,
        photo:      false,
      }
    };
  }

  /* ── Object format ── */
  const parseBool = v => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() === 'true' || v === '1' || v.toLowerCase() === 'yes';
    return !!v;
  };
  const rawDocs = r.docs || {};
  return {
    id:         r.id         || (i + 1),
    plate:      r.plate      || '',
    chassis:    r.chassis    || '',
    make:       r.make       || '—',
    model:      r.model      || '—',
    year:       r.year       ? Number(r.year) : null,
    colour:     r.colour     || r.color || '',
    cc:         r.cc         ? Number(r.cc) : null,
    emirate:    r.emirate    || '',
    owner:      r.owner      || '',
    ownerEid:   r.ownerEid   || '',
    licence:    r.licence    || '',
    licCat:     r.licCat     || '',
    mobile:     r.mobile     || '',
    ref:        r.ref        || r.reference || '',
    mulkiyaExp: r.mulkiyaExp || '',
    insExp:     r.insExp     || '',
    licExp:     r.licExp     || '',
    fine:       r.fine       ? Number(r.fine) : 0,
    docs: {
      mulkiya:    parseBool(rawDocs.mulkiya),
      insurance:  parseBool(rawDocs.insurance),
      licence:    parseBool(rawDocs.licence),
      eid:        parseBool(rawDocs.eid),
      purchase:   parseBool(rawDocs.purchase),
      inspection: parseBool(rawDocs.inspection),
      clearance:  parseBool(rawDocs.clearance),
      photo:      parseBool(rawDocs.photo),
    }
  };
}

/**
 * Fetches bike rows from the Google Apps Script web-app.
 * Uses stale-while-revalidate: shows cached data immediately, then
 * fetches fresh data in background and updates the table.
 */
async function loadBikes() {
  const tbody = document.getElementById('bike-tbody');

  /* ── Step 1: show cached data immediately if available ── */
  const cached = bikeCacheLoad();
  if (cached && cached.length) {
    bikes = cached.map((r, i) => normaliseBikeRow(r, i)).filter(Boolean);
    renderBikeTable(bikes);
    updateBadges();
    showBikeCacheBanner(true); // show "refreshing" notice
  } else {
    if (tbody) {
      tbody.innerHTML = `
        <tr><td colspan="8" style="text-align:center;padding:30px;">
          <i class="ti ti-loader" style="animation:spin 1s linear infinite;display:inline-block;font-size:22px;color:var(--text3);"></i>
          <div style="margin-top:8px;color:var(--text3);font-size:13px;">Loading bikes…</div>
        </td></tr>`;
    }
  }

  /* ── Step 2: fetch fresh data in background ── */
  try {
    const res  = await fetch(BIKE_SHEET_URL + '&nocache=' + Date.now());
    const raw  = await res.json();
    const rows = parseRows(raw);

    bikeCacheSave(rows); // save raw rows for next load
    bikes = rows.map((r, i) => normaliseBikeRow(r, i)).filter(Boolean);
    renderBikeTable(bikes);
    updateBadges();
    showBikeCacheBanner(false);

  } catch (err) {
    console.error('loadBikes error:', err);
    if (!cached || !cached.length) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--red);">
          Error loading bike data — check console for details.
        </td></tr>`;
      }
    } else {
      showBikeCacheBanner(false); // still show cached data, note the time
    }
  }
}



/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
let toastTimer;
function toast(msg, type='success') {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  const icon  = document.getElementById('toast-icon');
  clearTimeout(toastTimer);
  el.className = 'toast';
  msgEl.textContent = msg;
  icon.className = type === 'error' ? 'ti ti-x-circle' : 'ti ti-circle-check';
  requestAnimationFrame(() => {
    el.classList.add('show', type);
  });
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3500);
}

/* ═══════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════ */
const VIEW_TITLES = {
  dashboard:          'Dashboard',
  'emp-list':         'All Employees',
  'emp-add':          'Add Employee',
  'emp-expiring':     'Expiring Documents',
  'bike-list':        'Bike Fleet',
  'bike-add':         'Register Bike',
  'bike-expiring':    'Expiring Documents',
  'checkout-portal':  'Check In / Out',
  'checkout-active':  'Active Checkouts & History',
  'checkout-manage':  'Manage Fleet',
};

function showView(viewId, navEl) {
  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  // Show target
  const target = document.getElementById('view-' + viewId);
  if (target) target.classList.add('active');

  // Update nav
  document.querySelectorAll('.nav-item, .nav-sub-item').forEach(n => n.classList.remove('active'));
  if (navEl) {
    navEl.classList.add('active');
  } else {
    const match = document.querySelector(`.nav-item[data-view="${viewId}"], .nav-sub-item[data-view="${viewId}"]`);
    if (match) match.classList.add('active');
  }

  // Update topbar title
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = VIEW_TITLES[viewId] || viewId;

  // Topbar add button
  const addBtn = document.getElementById('topbar-add-btn');
  if (addBtn) {
    const showAddFor = ['emp-list','bike-list','emp-expiring','bike-expiring'];
    addBtn.style.display = showAddFor.includes(viewId) ? 'inline-flex' : 'none';
    addBtn.dataset.view = viewId;
  }

  // Render relevant data
  if (viewId === 'dashboard')           renderDashboard();
  if (viewId === 'emp-list')            renderEmpTable(employees);
  if (viewId === 'emp-expiring')        renderEmpExpiring();
  if (viewId === 'bike-list')           { renderBikeTable(bikes); loadBikes(); }
  if (viewId === 'bike-expiring')       renderBikeExpiring();
  if (viewId === 'emp-add')             resetEmpForm();
  if (viewId === 'bike-add')            resetBikeForm();
  if (viewId === 'checkout-portal')     { coLoad(); coRefreshForm(); coRenderCheckin(); }
  if (viewId === 'checkout-active')     { coLoad(); coRenderActive(); coRenderHistory(); }
  if (viewId === 'checkout-manage')     { coLoad(); coRenderFleet(); coRenderEmpTable(); }

  // Open parent nav group
  openParentForView(viewId);

  // Close sidebar on mobile
  closeSidebar();
}

function topbarAdd() {
  const v = document.getElementById('topbar-add-btn').dataset.view;
  if (v && v.startsWith('emp')) showView('emp-add', null);
  else showView('bike-add', null);
}

/* ═══════════════════════════════════════════════
   TWO-LEVEL NAV
   ═══════════════════════════════════════════════ */
function toggleParent(key) {
  const parent = document.getElementById('parent-' + key);
  const sub    = document.getElementById('sub-' + key);
  const isOpen = sub.classList.contains('open');
  // Close all
  document.querySelectorAll('.nav-sub').forEach(s => s.classList.remove('open'));
  document.querySelectorAll('.nav-parent').forEach(p => p.classList.remove('open'));
  // Open this one if it was closed
  if (!isOpen) {
    sub.classList.add('open');
    parent.classList.add('open');
  }
}

// Keep the relevant parent open without toggling
function openParentOnly(key) {
  const parent = document.getElementById('parent-' + key);
  const sub    = document.getElementById('sub-' + key);
  if (parent && sub) {
    sub.classList.add('open');
    parent.classList.add('open');
  }
}

// Auto-open the relevant parent when a sub-item is active
function openParentForView(viewId) {
  if (viewId.startsWith('emp'))           openParentOnly('emp');
  else if (viewId.startsWith('bike'))     openParentOnly('bike');
  else if (viewId.startsWith('checkout')) openParentOnly('checkout');
}

/* ═══════════════════════════════════════════════
   SIDEBAR TOGGLE
   ═══════════════════════════════════════════════ */
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('overlay');
  sb.classList.toggle('open');
  ov.classList.toggle('show');
}
function closeSidebar() {
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('show');
  }
}

/* ═══════════════════════════════════════════════
   BADGES
   ═══════════════════════════════════════════════ */
function updateBadges() {
  document.getElementById('emp-nav-badge').textContent  = employees.length;
  document.getElementById('bike-nav-badge').textContent = bikes.length;
  const ee = employees.filter(e => isExpiring(e.eidExp)||isExpiring(e.visaExp)||isExpired(e.eidExp)||isExpired(e.visaExp)).length;
  const be = bikes.filter(b => isExpiring(b.mulkiyaExp)||isExpiring(b.insExp)||isExpired(b.mulkiyaExp)||isExpired(b.insExp)).length;
  document.getElementById('emp-exp-badge').textContent  = ee;
  document.getElementById('bike-exp-badge').textContent = be;

  // Header alert badge
  const total = ee + be;
  const alertBadge = document.getElementById('alert-count');
  if (alertBadge) {
    alertBadge.textContent = total;
    alertBadge.style.display = total > 0 ? 'flex' : 'none';
  }
}

/* ═══════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════ */
function renderDashboard() {
  // Overall stats
  const expEmp  = employees.filter(e => isExpiring(e.eidExp)||isExpired(e.eidExp)||isExpiring(e.visaExp)||isExpired(e.visaExp)).length;
  const expBike = bikes.filter(b => isExpiring(b.mulkiyaExp)||isExpired(b.mulkiyaExp)||isExpiring(b.insExp)||isExpired(b.insExp)).length;
  const totalFine = bikes.reduce((s, b) => s + (b.fine || 0), 0);
  const empFull   = employees.filter(e => EMP_DOCS.every(k => e.docs[k])).length;

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card accent">
      <div class="stat-icon"><i class="ti ti-users"></i></div>
      <div class="stat-label">Employees</div>
      <div class="stat-val">${employees.length}</div>
      <div class="stat-sub">${empFull} with full documents</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon"><i class="ti ti-motorbike"></i></div>
      <div class="stat-label">Bikes Registered</div>
      <div class="stat-val">${bikes.length}</div>
      <div class="stat-sub">UAE fleet total</div>
    </div>
    <div class="stat-card ${expEmp + expBike > 0 ? 'warn' : 'success'}">
      <div class="stat-icon"><i class="ti ti-alert-triangle"></i></div>
      <div class="stat-label">Expiring Soon</div>
      <div class="stat-val">${expEmp + expBike}</div>
      <div class="stat-sub">${expEmp} emp · ${expBike} bikes</div>
    </div>
    <div class="stat-card ${totalFine > 0 ? 'danger' : 'success'}">
      <div class="stat-icon"><i class="ti ti-currency-dollar"></i></div>
      <div class="stat-label">RTA Fines (AED)</div>
      <div class="stat-val">${totalFine.toLocaleString()}</div>
      <div class="stat-sub">Outstanding total</div>
    </div>
  `;

  // Recent employees
  const empListEl = document.getElementById('dash-emp-list');
  empListEl.innerHTML = employees.slice(0,5).map((e, i) => `
    <div class="dash-list-item">
      ${av(e.name, i)}
      <div style="flex:1;min-width:0;">
        <div class="dli-name">${e.name}</div>
        <div class="dli-sub">${e.company || '—'}</div>
      </div>
      <span class="badge ${empStatus(e)}">${capFirst(empStatus(e))}</span>
    </div>`).join('');

  // Recent bikes
  const bikeListEl = document.getElementById('dash-bike-list');
  bikeListEl.innerHTML = bikes.slice(0,5).map((b, i) => `
    <div class="dash-list-item">
      ${bikeAv(i)}
      <div style="flex:1;min-width:0;">
        <div class="dli-name">${b.make} ${b.model}</div>
        <div class="dli-sub">${b.owner}</div>
      </div>
      <span class="badge ${bikeStatus(b)}">${capFirst(bikeStatus(b))}</span>
    </div>`).join('');

  updateBadges();
}

function capFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

/* ═══════════════════════════════════════════════
   EMPLOYEE TABLE
   ═══════════════════════════════════════════════ */
let currentHRFilter = 'all';

/* ── Map API color strings → CSS badge class names ── */
function apiColorToCss(color) {
  const map = { green:'valid', red:'expired', pink:'expiring_soon', gray:'gray' };
  return map[color] || color || 'gray';
}

/* ── Render label for status string ── */
function statusLabel(status) {
  const map = {
    valid:         'Valid',
    expired:       'Expired',
    expiring_soon: 'Expiring Soon',
    not_available: 'No Data',
    invalid:       'Invalid',
  };
  return map[status] || status || '—';
}

/* ── Overall status for filtering:
      Only consider fields that actually have a date — missing fields are ignored
      so employees with partial data still show up under the right filter.
      Row highlighting still uses the same function so expired rows stay red. ── */
function calcOverall(ex) {
  const ss = [ex.eid?.status, ex.license?.status, ex.labour?.status, ex.insurance?.status];
  const present = ss.filter(s => s && s !== 'not_available');

  // No date data at all — treat as expired
  if (present.length === 0) return 'expired';

  if (present.includes('expired') || present.includes('invalid')) return 'expired';
  if (present.includes('expiring_soon')) return 'expiring_soon';
  return 'valid';
}

let empSearchQuery = '';
const EMP_PAGE_SIZE = 100;
let empCurrentPage = 1;

function getFilteredEmps(list) {
  const lq = (empSearchQuery || '').toLowerCase().trim();
  return list.filter(emp => {
    if (lq) {
      const matches =
        (emp.name      || '').toLowerCase().includes(lq) ||
        (emp.eid       || '').toLowerCase().includes(lq) ||
        (String(emp.id)|| '').includes(lq) ||
        (emp.reference || '').toLowerCase().includes(lq) ||
        (emp.ref       || '').toLowerCase().includes(lq);
      if (!matches) return false;
    }
    if (currentHRFilter !== 'all') {
      const overall = calcOverall(emp.expiry || {});
      if (overall !== currentHRFilter) return false;
    }
    return true;
  });
}

function buildEmpRow(emp) {
  const ex     = emp.expiry || {};
  const eidEx  = ex.eid       || {};
  const licEx  = ex.license   || {};
  const labEx  = ex.labour    || {};
  const insEx  = ex.insurance || {};

  const rawDate = (expObj) => {
    if (!expObj || !expObj.date) return '<span style="color:var(--text3);">—</span>';
    return `<span style="font-family:var(--mono);font-size:12px;">${expObj.date}</span>`;
  };

  const overall = calcOverall(ex);
  let rowStyle = '';
  if (overall === 'expired')            rowStyle = 'style="border-left:4px solid #b3261e;background:rgba(248,81,73,.04);"';
  else if (overall === 'expiring_soon') rowStyle = 'style="border-left:4px solid #a15c00;background:rgba(227,179,65,.04);"';

  const hrBadge = emp.hrStatus
    ? `<span class="badge" style="background:rgba(88,166,255,.15);color:#58a6ff;border:1px solid rgba(88,166,255,.3);white-space:nowrap;">${emp.hrStatus}</span>`
    : '<span style="color:var(--text3);">—</span>';

  return `
    <tr ${rowStyle}>
      <td style="font-family:var(--mono);font-size:11px;color:var(--text3);white-space:nowrap;">${emp.id || '—'}</td>
      <td style="white-space:nowrap;"><b>${emp.name || '—'}</b></td>
      <td>${rawDate(eidEx)}</td>
      <td>${rawDate(licEx)}</td>
      <td>${rawDate(labEx)}</td>
      <td>${rawDate(insEx)}</td>
      <td style="white-space:nowrap;">${emp.checkoutException || '<span style="color:var(--text3);">—</span>'}</td>
      <td>${hrBadge}</td>
      <td>
        <button class="tb-btn view-btn" style="padding:6px 12px;font-size:12px;" onclick="viewEmployee(${JSON.stringify(emp.id)})">
          <i class="ti ti-eye"></i><span class="btn-text"> View</span>
        </button>
      </td>
    </tr>`;
}

function renderEmpPagination(total, page) {
  const totalPages = Math.ceil(total / EMP_PAGE_SIZE);
  let el = document.getElementById('emp-pagination');
  if (!el) {
    el = document.createElement('div');
    el.id = 'emp-pagination';
    el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 4px;flex-wrap:wrap;';
    const tbl = document.getElementById('emp-tbody')?.closest('table');
    tbl?.parentElement?.appendChild(el);
  }
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const btn = (label, pg, disabled, active) =>
    `<button onclick="empGoToPage(${pg})"
      style="padding:5px 11px;font-size:12px;border-radius:6px;border:1px solid var(--border);
             background:${active ? 'var(--accent)' : 'var(--card)'};
             color:${active ? '#fff' : 'var(--text1)'};
             cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? '.4' : '1'};"
      ${disabled ? 'disabled' : ''}>${label}</button>`;

  const start = (page - 1) * EMP_PAGE_SIZE + 1;
  const end   = Math.min(page * EMP_PAGE_SIZE, total);

  let pages = '';
  // Show first, last, and window around current page
  const window2 = 2;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - window2 && p <= page + window2)) {
      pages += btn(p, p, false, p === page);
    } else if (p === page - window2 - 1 || p === page + window2 + 1) {
      pages += `<span style="color:var(--text3);padding:0 2px;">…</span>`;
    }
  }

  el.innerHTML =
    btn('‹ Prev', page - 1, page === 1, false) +
    pages +
    btn('Next ›', page + 1, page === totalPages, false) +
    `<span style="font-size:12px;color:var(--text3);margin-left:6px;">${start}–${end} of ${total}</span>`;
}

function renderEmpTable(list) {
  const tbody = document.getElementById('emp-tbody');
  tbody.innerHTML = '';

  const filtered = getFilteredEmps(list);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px 16px;">
      <div style="color:var(--text3);display:flex;flex-direction:column;align-items:center;gap:10px;">
        <i class="ti ti-users-minus" style="font-size:36px;opacity:.4;"></i>
        <span style="font-size:13px;">No employees match this filter</span>
      </div>
    </td></tr>`;
    renderEmpPagination(0, 1);
    return;
  }

  // Clamp page to valid range
  const totalPages = Math.ceil(filtered.length / EMP_PAGE_SIZE);
  if (empCurrentPage > totalPages) empCurrentPage = totalPages;
  if (empCurrentPage < 1) empCurrentPage = 1;

  const start = (empCurrentPage - 1) * EMP_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + EMP_PAGE_SIZE);

  // Build all rows as one string — much faster than appending one by one
  tbody.innerHTML = pageRows.map(buildEmpRow).join('');

  renderEmpPagination(filtered.length, empCurrentPage);
}

function empGoToPage(page) {
  empCurrentPage = page;
  renderEmpTable(employees);
  // Scroll table into view
  document.getElementById('emp-tbody')?.closest('table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterEmps(q) {
  empSearchQuery = q || '';
  empCurrentPage = 1; // reset to first page on new search
  renderEmpTable(employees);
}

function filterHR(type) {
  currentHRFilter = type;
  empCurrentPage = 1; // reset to first page on filter change
  document.querySelectorAll('.hr-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === type);
  });
  renderEmpTable(employees);
}

/* ═══════════════════════════════════════════════
   EMPLOYEE VIEW POPUP
   ═══════════════════════════════════════════════ */
function viewEmployee(empId) {
  const emp = employees.find(e => String(e.id) === String(empId));
  if (!emp) { console.warn('viewEmployee: not found', empId); return; }

  const ex = emp.expiry || {};

  function fmtDate(d) {
    if (!d) return '<span style="color:var(--text3);">—</span>';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  function vrow(label, val) {
    return `<div class="vp-row">
      <span class="vp-label">${label}</span>
      <span class="vp-val">${val || '<span style="color:var(--text3);">—</span>'}</span>
    </div>`;
  }

  function docCard(label, expObj) {
    const s   = expObj && expObj.status ? expObj.status : 'not_available';
    const dt  = expObj && expObj.date   ? expObj.date   : null;
    const css = apiColorToCss(expObj && expObj.color ? expObj.color : 'gray');
    const colorVar = css === 'valid' ? 'var(--teal)' : css === 'expired' ? 'var(--red)' : css === 'expiring_soon' ? 'var(--amber)' : 'var(--text3)';
    const bgVar    = css === 'valid' ? 'var(--teal-dim)' : css === 'expired' ? 'var(--red-dim)' : css === 'expiring_soon' ? 'var(--amber-dim)' : 'rgba(100,100,100,.1)';
    return `
      <div style="background:${bgVar};border-radius:6px;padding:10px 12px;border:1px solid ${colorVar}44;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">${label}</div>
        <div style="font-size:12px;font-weight:700;color:${colorVar};text-transform:capitalize;">${statusLabel(s)}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px;">${fmtDate(dt)}</div>
      </div>`;
  }

  const overall = (() => {
    const ss = [ex.eid?.status, ex.license?.status, ex.labour?.status, ex.insurance?.status];
    if (ss.includes('expired'))       return { css:'expired',       label:'Expired' };
    if (ss.includes('expiring_soon')) return { css:'expiring_soon', label:'Expiring Soon' };
    return { css:'valid', label:'Valid' };
  })();

  // Remove any existing popup
  document.getElementById('emp-view-modal')?.remove();

  const html = `
    <div class="modal-backdrop open" id="emp-view-modal" onclick="if(event.target===this)this.remove()">
      <div class="modal" style="max-width:620px;width:95%;max-height:90vh;overflow-y:auto;">

        <div class="modal-header" style="position:sticky;top:0;background:var(--bg2);z-index:10;">
          <h2 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <i class="ti ti-user-circle" style="color:var(--accent);"></i>
            Employee Record
            <span class="badge ${overall.css}" style="font-size:11px;">${overall.label}</span>
          </h2>
          <button class="action-btn" onclick="document.getElementById('emp-view-modal').remove()">
            <i class="ti ti-x"></i>
          </button>
        </div>

        <div class="modal-body" style="padding-top:12px;display:flex;flex-direction:column;gap:14px;">

          <!-- Personal Info -->
          <div style="background:var(--bg3);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:10px;">
              <i class="ti ti-user" style="margin-right:4px;"></i>Personal Information
            </div>
            ${vrow('Emp ID',     `<span style="font-family:var(--mono);font-size:12px;color:var(--accent);">${emp.id || '—'}</span>`)}
            ${vrow('Full Name',  `<b style="font-size:14px;">${emp.name || '—'}</b>`)}
            ${vrow('EID Number', `<span style="font-family:var(--mono);font-size:12px;">${emp.eid || '—'}</span>`)}
            ${vrow('Date of Birth', fmtDate(emp.dob))}
            ${vrow('UAE Mobile',    emp.mobile || '')}
            ${vrow('Emergency Contact', emp.emergency || '')}
            ${vrow('Reference / Company', emp.reference || emp.ref || '')}
            ${vrow('Timestamp', fmtDate(emp.timestamp))}
          </div>

          <!-- Doc Expiry Cards -->
          <div style="background:var(--bg3);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:12px;">
              <i class="ti ti-calendar-event" style="margin-right:4px;"></i>Document Expiry Status
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              ${docCard('Emirates ID',     ex.eid)}
              ${docCard('Driving License', ex.license)}
              ${docCard('Labour Card',     ex.labour)}
              ${docCard('Insurance',       ex.insurance)}
            </div>
          </div>

          <!-- HR & Compliance -->
          <div style="background:var(--bg3);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:10px;">
              <i class="ti ti-shield-check" style="margin-right:4px;"></i>HR &amp; Compliance
            </div>
            ${vrow('HR Status', emp.hrStatus
              ? `<span style="font-weight:600;color:var(--accent);">${emp.hrStatus}</span>`
              : '')}
            ${vrow('Checkout Exception', emp.checkoutException || '')}
          </div>

        </div>

        <div class="modal-footer" style="position:sticky;bottom:0;background:var(--bg2);z-index:10;">
          <button class="tb-btn" onclick="document.getElementById('emp-view-modal').remove()">
            <i class="ti ti-x"></i> Close
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}

/* ─── Employee expiring ─── */
function renderEmpExpiring() {
  const data = employees.filter(e => isExpiring(e.eidExp)||isExpiring(e.visaExp)||isExpired(e.eidExp)||isExpired(e.visaExp));
  document.getElementById('emp-exp-tbody').innerHTML = data.length
    ? data.map((e, i) => {
        const st = empStatus(e);
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:10px;">${av(e.name,i)}<div><div class="cell-name">${e.name}</div></div></div></td>
          <td style="font-family:var(--mono);font-size:12px;">${e.eid || '—'}</td>
          <td style="font-size:12px;${dateColor(e.eidExp)}">${e.eidExp || '—'}</td>
          <td>${e.company || '—'}</td>
          <td><span class="badge ${st}">${capFirst(st)}</span></td>
          <td><button class="action-btn" onclick="openEmpEdit(${e.id})"><i class="ti ti-pencil"></i> Edit</button></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text3);"><i class="ti ti-circle-check" style="font-size:24px;display:block;margin:0 auto 8px;color:var(--teal);"></i>No expiring employee documents.</td></tr>`;
}

/* ─── Employee CRUD ─── */
function resetEmpForm() {
  ['ef-name','ef-eid','ef-dob','ef-eid-exp','ef-mobile','ef-mobile-pak','ef-company','ef-ref','ef-visa-exp'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  empPending = {};
  EMP_DOCS.forEach(k => {
    const s = document.getElementById('es-' + k), b = document.getElementById('eu-' + k);
    if (s) { s.textContent = 'Upload'; s.className = 'upload-status'; }
    if (b) b.className = 'upload-box';
  });
}

function saveEmployee() {
  const name = document.getElementById('ef-name').value.trim();
  if (!name) { toast('Full name is required.', 'error'); return; }
  const docs = {};
  EMP_DOCS.forEach(k => docs[k] = !!empPending[k]);
  employees.push({
    id: nextEmpId++, name,
    eid:       document.getElementById('ef-eid').value,
    dob:       document.getElementById('ef-dob').value,
    eidExp:    document.getElementById('ef-eid-exp').value,
    mobile:    document.getElementById('ef-mobile').value,
    mobilePak: document.getElementById('ef-mobile-pak').value,
    company:   document.getElementById('ef-company').value,
    ref:       document.getElementById('ef-ref').value,
    visaExp:   document.getElementById('ef-visa-exp') ? document.getElementById('ef-visa-exp').value : '',
    docs,
  });
  updateBadges();
  toast('Employee saved successfully.');
  showView('emp-list', null);
}

function openEmpEdit(id) {
  const e = employees.find(x => x.id === id); if (!e) return;
  editEmpId = id;
  document.getElementById('em-name').value     = e.name;
  document.getElementById('em-eid').value      = e.eid || '';
  document.getElementById('em-mobile').value   = e.mobile || '';
  document.getElementById('em-mobile-pak').value = e.mobilePak || '';
  document.getElementById('em-company').value  = e.company || '';
  document.getElementById('em-visa-exp').value = e.visaExp || '';
  document.getElementById('em-eid-exp').value  = e.eidExp || '';
  document.getElementById('em-ref').value      = e.ref || '';
  document.getElementById('emp-modal').classList.add('open');
}

function updateEmployee() {
  const e = employees.find(x => x.id === editEmpId); if (!e) return;
  e.name     = document.getElementById('em-name').value;
  e.eid      = document.getElementById('em-eid').value;
  e.mobile   = document.getElementById('em-mobile').value;
  e.mobilePak= document.getElementById('em-mobile-pak').value;
  e.company  = document.getElementById('em-company').value;
  e.visaExp  = document.getElementById('em-visa-exp').value;
  e.eidExp   = document.getElementById('em-eid-exp').value;
  e.ref      = document.getElementById('em-ref').value;
  closeModal('emp-modal'); renderEmpTable(employees); updateBadges();
  toast('Employee record updated.');
}

function deleteEmployee() {
  if (!confirm('Delete this employee record? This cannot be undone.')) return;
  employees = employees.filter(x => x.id !== editEmpId);
  closeModal('emp-modal'); renderEmpTable(employees); updateBadges();
  toast('Employee deleted.');
}

/* ═══════════════════════════════════════════════
   BIKE TABLE
   ═══════════════════════════════════════════════ */
let bikeSearchQuery  = '';
let currentBikeFilter = 'all';
const BIKE_PAGE_SIZE  = 100;
let bikeCurrentPage   = 1;

function getFilteredBikes(list) {
  const lq = (bikeSearchQuery || '').toLowerCase().trim();
  return list.filter(b => {
    if (lq) {
      const matches =
        (b.plate   || '').toLowerCase().includes(lq) ||
        (b.make    || '').toLowerCase().includes(lq) ||
        (b.model   || '').toLowerCase().includes(lq) ||
        (b.owner   || '').toLowerCase().includes(lq) ||
        (b.ref     || '').toLowerCase().includes(lq) ||
        (b.emirate || '').toLowerCase().includes(lq) ||
        (String(b.id) || '').includes(lq);
      if (!matches) return false;
    }
    if (currentBikeFilter !== 'all') {
      const st = bikeStatus(b);
      // normalise: 'expiring' label in filter maps to bikeStatus 'expiring'
      if (currentBikeFilter === 'expiring' && st !== 'expiring') return false;
      if (currentBikeFilter === 'expired'  && st !== 'expired')  return false;
      if (currentBikeFilter === 'active'   && st !== 'active')   return false;
    }
    return true;
  });
}

function buildBikeRow(b, i) {
  const st = bikeStatus(b);
  let rowStyle = '';
  if (st === 'expired')  rowStyle = 'style="border-left:4px solid #b3261e;background:rgba(248,81,73,.04);"';
  if (st === 'expiring') rowStyle = 'style="border-left:4px solid #a15c00;background:rgba(227,179,65,.04);"';

  return `<tr ${rowStyle}>
    <td>
      <div style="display:flex;align-items:center;gap:10px;">
        ${bikeAv(i)}
        <div><div class="cell-name">${b.make} ${b.model}</div><div class="cell-sub">${b.owner || '—'}</div></div>
      </div>
    </td>
    <td><span class="plate">${b.plate || '—'}</span></td>
    <td style="font-size:12px;${dateColor(b.mulkiyaExp)}">${b.mulkiyaExp || '—'}</td>
    <td style="font-size:12px;${dateColor(b.insExp)}">${b.insExp || '—'}</td>
    <td><div class="doc-dots">${dots(b.docs, BIKE_DOCS, 'bike', b.id)}</div></td>
    <td style="font-size:12.5px;${b.fine > 0 ? 'color:var(--red);font-weight:600;' : 'color:var(--text3);'}">${b.fine > 0 ? 'AED ' + b.fine.toLocaleString() : '—'}</td>
    <td><span class="badge ${st}">${capFirst(st)}</span></td>
    <td>
      <div style="display:flex;gap:6px;">
        <button class="tb-btn view-btn" style="padding:6px 12px;font-size:12px;" onclick="viewBike(${JSON.stringify(b.id)})">
          <i class="ti ti-eye"></i><span class="btn-text"> View</span>
        </button>
        <button class="action-btn" onclick="openBikeEdit(${b.id})"><i class="ti ti-pencil"></i></button>
      </div>
    </td>
  </tr>`;
}

function renderBikePagination(total, page) {
  const totalPages = Math.ceil(total / BIKE_PAGE_SIZE);
  let el = document.getElementById('bike-pagination');
  if (!el) {
    el = document.createElement('div');
    el.id = 'bike-pagination';
    el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:12px 4px;flex-wrap:wrap;';
    const tbl = document.getElementById('bike-tbody')?.closest('table');
    tbl?.parentElement?.appendChild(el);
  }
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const btn = (label, pg, disabled, active) =>
    `<button onclick="bikeGoToPage(${pg})"
      style="padding:5px 11px;font-size:12px;border-radius:6px;border:1px solid var(--border);
             background:${active ? 'var(--accent)' : 'var(--card)'};
             color:${active ? '#fff' : 'var(--text1)'};
             cursor:${disabled ? 'default' : 'pointer'};opacity:${disabled ? '.4' : '1'};"
      ${disabled ? 'disabled' : ''}>${label}</button>`;

  const start = (page - 1) * BIKE_PAGE_SIZE + 1;
  const end   = Math.min(page * BIKE_PAGE_SIZE, total);

  let pages = '';
  const window2 = 2;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - window2 && p <= page + window2)) {
      pages += btn(p, p, false, p === page);
    } else if (p === page - window2 - 1 || p === page + window2 + 1) {
      pages += `<span style="color:var(--text3);padding:0 2px;">…</span>`;
    }
  }

  el.innerHTML =
    btn('‹ Prev', page - 1, page === 1, false) +
    pages +
    btn('Next ›', page + 1, page === totalPages, false) +
    `<span style="font-size:12px;color:var(--text3);margin-left:6px;">${start}–${end} of ${total}</span>`;
}

function renderBikeTable(data) {
  const expB  = data.filter(b => isExpiring(b.mulkiyaExp)||isExpiring(b.insExp)||isExpired(b.mulkiyaExp)||isExpired(b.insExp)).length;
  const fines = bikes.reduce((s, b) => s + (b.fine || 0), 0);
  const full  = data.filter(b => BIKE_DOCS.every(k => b.docs[k])).length;

  document.getElementById('bike-stats').innerHTML = `
    <div class="stat-card accent">
      <div class="stat-icon"><i class="ti ti-motorbike"></i></div>
      <div class="stat-label">Total Bikes</div>
      <div class="stat-val">${bikes.length}</div>
      <div class="stat-sub">Registered fleet</div>
    </div>
    <div class="stat-card success">
      <div class="stat-icon"><i class="ti ti-file-check"></i></div>
      <div class="stat-label">Docs Complete</div>
      <div class="stat-val">${full}</div>
      <div class="stat-sub">All docs uploaded</div>
    </div>
    <div class="stat-card ${expB > 0 ? 'warn' : ''}">
      <div class="stat-icon"><i class="ti ti-clock"></i></div>
      <div class="stat-label">Expiring Soon</div>
      <div class="stat-val">${expB}</div>
      <div class="stat-sub">Within ${WARN_DAYS} days</div>
    </div>
    <div class="stat-card ${fines > 0 ? 'danger' : 'success'}">
      <div class="stat-icon"><i class="ti ti-receipt"></i></div>
      <div class="stat-label">RTA Fines (AED)</div>
      <div class="stat-val">${fines.toLocaleString()}</div>
      <div class="stat-sub">Outstanding total</div>
    </div>
  `;

  const tbody = document.getElementById('bike-tbody');
  tbody.innerHTML = '';

  const filtered = getFilteredBikes(data);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px 16px;">
      <div style="color:var(--text3);display:flex;flex-direction:column;align-items:center;gap:10px;">
        <i class="ti ti-motorbike" style="font-size:36px;opacity:.4;"></i>
        <span style="font-size:13px;">No bikes match this filter</span>
      </div>
    </td></tr>`;
    renderBikePagination(0, 1);
    return;
  }

  // Clamp page
  const totalPages = Math.ceil(filtered.length / BIKE_PAGE_SIZE);
  if (bikeCurrentPage > totalPages) bikeCurrentPage = totalPages;
  if (bikeCurrentPage < 1) bikeCurrentPage = 1;

  const start    = (bikeCurrentPage - 1) * BIKE_PAGE_SIZE;
  const pageRows = filtered.slice(start, start + BIKE_PAGE_SIZE);

  tbody.innerHTML = pageRows.map((b, i) => buildBikeRow(b, start + i)).join('');
  renderBikePagination(filtered.length, bikeCurrentPage);
}

function bikeGoToPage(page) {
  bikeCurrentPage = page;
  renderBikeTable(bikes);
  document.getElementById('bike-tbody')?.closest('table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function filterBikes(q) {
  bikeSearchQuery  = q || '';
  bikeCurrentPage  = 1;
  renderBikeTable(bikes);
}

function filterBikeStatus(type) {
  currentBikeFilter = type;
  bikeCurrentPage   = 1;
  document.querySelectorAll('.bike-filter-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === type);
  });
  renderBikeTable(bikes);
}

/* ─── Bike expiring ─── */
function renderBikeExpiring() {
  const data = bikes.filter(b => isExpiring(b.mulkiyaExp)||isExpiring(b.insExp)||isExpired(b.mulkiyaExp)||isExpired(b.insExp));
  document.getElementById('bike-exp-tbody').innerHTML = data.length
    ? data.map((b, i) => {
        const st = bikeStatus(b);
        return `<tr>
          <td><div style="display:flex;align-items:center;gap:10px;">${bikeAv(i)}<div class="cell-name">${b.make} ${b.model}</div></div></td>
          <td><span class="plate">${b.plate}</span></td>
          <td>${b.owner}</td>
          <td style="font-size:12px;${dateColor(b.mulkiyaExp)}">${b.mulkiyaExp || '—'}</td>
          <td style="font-size:12px;${dateColor(b.insExp)}">${b.insExp || '—'}</td>
          <td><span class="badge ${st}">${capFirst(st)}</span></td>
          <td><button class="action-btn" onclick="openBikeEdit(${b.id})"><i class="ti ti-pencil"></i> Edit</button></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text3);"><i class="ti ti-circle-check" style="font-size:24px;display:block;margin:0 auto 8px;color:var(--teal);"></i>No expiring bike documents.</td></tr>`;
}

/* ─── Bike view popup ─── */
function viewBike(bikeId) {
  const b = bikes.find(x => String(x.id) === String(bikeId));
  if (!b) { console.warn('viewBike: not found', bikeId); return; }

  function fmtDate(d) {
    if (!d) return '<span style="color:var(--text3);">—</span>';
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  }

  function vrow(label, val) {
    return `<div class="vp-row">
      <span class="vp-label">${label}</span>
      <span class="vp-val">${val || '<span style="color:var(--text3);">—</span>'}</span>
    </div>`;
  }

  function docCard(label, dateStr) {
    const css      = isExpired(dateStr) ? 'expired' : isExpiring(dateStr) ? 'expiring_soon' : dateStr ? 'valid' : 'not_available';
    const colorVar = css === 'valid' ? 'var(--teal)' : css === 'expired' ? 'var(--red)' : css === 'expiring_soon' ? 'var(--amber)' : 'var(--text3)';
    const bgVar    = css === 'valid' ? 'var(--teal-dim)' : css === 'expired' ? 'var(--red-dim)' : css === 'expiring_soon' ? 'var(--amber-dim)' : 'rgba(100,100,100,.1)';
    const lbl      = css === 'valid' ? 'Valid' : css === 'expired' ? 'Expired' : css === 'expiring_soon' ? 'Expiring Soon' : 'No Data';
    return `
      <div style="background:${bgVar};border-radius:6px;padding:10px 12px;border:1px solid ${colorVar}44;">
        <div style="font-size:11px;color:var(--text2);margin-bottom:4px;">${label}</div>
        <div style="font-size:12px;font-weight:700;color:${colorVar};">${lbl}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px;">${fmtDate(dateStr)}</div>
      </div>`;
  }

  const st = bikeStatus(b);
  const stLabel = st === 'expired' ? 'Expired' : st === 'expiring' ? 'Expiring Soon' : 'Active';

  // Doc completion summary
  const totalDocs = BIKE_DOCS.length;
  const doneDocs  = BIKE_DOCS.filter(k => b.docs && b.docs[k]).length;
  const docsColor = doneDocs === totalDocs ? 'var(--teal)' : doneDocs < totalDocs / 2 ? 'var(--red)' : 'var(--amber)';

  // Doc chips
  const docChips = BIKE_DOCS.map(k => {
    const ok = b.docs && b.docs[k];
    const state = dotState(b.docs || {}, k);
    const chipColor = state === 'ok' ? 'var(--teal)' : state === 'miss' ? 'var(--red)' : 'var(--amber)';
    const chipBg    = state === 'ok' ? 'var(--teal-dim)' : state === 'miss' ? 'var(--red-dim)' : 'var(--amber-dim)';
    const icon      = state === 'ok' ? 'ti-circle-check' : state === 'miss' ? 'ti-circle-x' : 'ti-clock';
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:20px;font-size:11px;background:${chipBg};color:${chipColor};border:1px solid ${chipColor}44;">
      <i class="ti ${icon}"></i>${k}
    </span>`;
  }).join('');

  // Remove any existing popup
  document.getElementById('bike-view-modal')?.remove();

  const html = `
    <div class="modal-backdrop open" id="bike-view-modal" onclick="if(event.target===this)this.remove()">
      <div class="modal" style="max-width:640px;width:95%;max-height:90vh;overflow-y:auto;">

        <div class="modal-header" style="position:sticky;top:0;background:var(--bg2);z-index:10;">
          <h2 style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <i class="ti ti-motorbike" style="color:var(--accent);"></i>
            Bike Record
            <span class="badge ${st}" style="font-size:11px;">${stLabel}</span>
          </h2>
          <button class="action-btn" onclick="document.getElementById('bike-view-modal').remove()">
            <i class="ti ti-x"></i>
          </button>
        </div>

        <div class="modal-body" style="padding-top:12px;display:flex;flex-direction:column;gap:14px;">

          <!-- Vehicle Info -->
          <div style="background:var(--bg3);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:10px;">
              <i class="ti ti-motorbike" style="margin-right:4px;"></i>Vehicle Information
            </div>
            ${vrow('Bike ID',       `<span style="font-family:var(--mono);font-size:12px;color:var(--accent);">${b.id || '—'}</span>`)}
            ${vrow('Plate Number',  `<span class="plate" style="font-size:13px;">${b.plate || '—'}</span>`)}
            ${vrow('Make / Model',  `<b style="font-size:14px;">${b.make} ${b.model}</b>`)}
            ${vrow('Year',          b.year || '')}
            ${vrow('Colour',        b.colour || '')}
            ${vrow('Engine (cc)',   b.cc ? b.cc + ' cc' : '')}
            ${vrow('Chassis / VIN', `<span style="font-family:var(--mono);font-size:11px;">${b.chassis || '—'}</span>`)}
            ${vrow('Emirate',       b.emirate || '')}
          </div>

          <!-- Owner / Rider Info -->
          <div style="background:var(--bg3);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:10px;">
              <i class="ti ti-user" style="margin-right:4px;"></i>Owner / Rider
            </div>
            ${vrow('Owner Name',   b.owner || '')}
            ${vrow('Owner EID',    `<span style="font-family:var(--mono);font-size:12px;">${b.ownerEid || '—'}</span>`)}
            ${vrow('Licence No.',  b.licence || '')}
            ${vrow('Licence Cat.', b.licCat || '')}
            ${vrow('Mobile',       b.mobile || '')}
            ${vrow('Reference',    b.ref || '')}
          </div>

          <!-- Expiry Status Cards -->
          <div style="background:var(--bg3);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:12px;">
              <i class="ti ti-calendar-event" style="margin-right:4px;"></i>Document Expiry Status
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
              ${docCard('Mulkiya',   b.mulkiyaExp)}
              ${docCard('Insurance', b.insExp)}
              ${docCard('Licence',   b.licExp)}
            </div>
          </div>

          <!-- Document Checklist -->
          <div style="background:var(--bg3);border-radius:var(--radius);padding:14px 16px;border:1px solid var(--border);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--text3);font-weight:700;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
              <span><i class="ti ti-files" style="margin-right:4px;"></i>Document Checklist</span>
              <span style="color:${docsColor};font-size:12px;font-weight:700;">${doneDocs}/${totalDocs} complete</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">${docChips}</div>
          </div>

          <!-- Fines -->
          ${b.fine > 0 ? `
          <div style="background:var(--red-dim);border-radius:var(--radius);padding:14px 16px;border:1px solid rgba(248,81,73,.25);">
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--red);font-weight:700;margin-bottom:6px;">
              <i class="ti ti-receipt" style="margin-right:4px;"></i>Outstanding RTA Fines
            </div>
            <div style="font-size:22px;font-weight:700;color:var(--red);">AED ${b.fine.toLocaleString()}</div>
          </div>` : ''}

        </div>

        <div class="modal-footer" style="position:sticky;bottom:0;background:var(--bg2);z-index:10;display:flex;gap:8px;">
          <button class="tb-btn" onclick="document.getElementById('bike-view-modal').remove()">
            <i class="ti ti-x"></i> Close
          </button>
          <button class="tb-btn primary" onclick="document.getElementById('bike-view-modal').remove();openBikeEdit(${b.id})">
            <i class="ti ti-pencil"></i> Edit
          </button>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('beforeend', html);
}
function resetBikeForm() {
  ['bf-plate','bf-chassis','bf-make','bf-model',
   'bf-mulkiya-exp','bf-ins-exp','bf-lic-exp'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // Generate and set hidden Bike ID
  const bikeIdEl = document.getElementById('bf-bike-id');
  if (bikeIdEl) bikeIdEl.value = generateBikeId();
  bikePending = {};
  BIKE_DOCS.forEach(k => {
    const s = document.getElementById('bs-' + k), b = document.getElementById('bu-' + k);
    if (s) { s.textContent = 'Upload'; s.className = 'upload-status'; }
    if (b) b.className = 'upload-box';
  });
}

/* ── Bike ID generation ── */
function generateBikeId() {
  const year = new Date().getFullYear();
  const seq  = String(nextBikeId).padStart(4, '0');
  return `BIKE-${year}-${seq}`;
}

/* ── Called when hidden iframe loads after Google Form submit ── */
let isBikeSubmitting = false;
function clearBikeForm() {
  if (!isBikeSubmitting) return;
  isBikeSubmitting = false;
  document.getElementById('bikeForm').reset();
  // Re-generate Bike ID for next entry
  const bikeIdEl = document.getElementById('bf-bike-id');
  if (bikeIdEl) bikeIdEl.value = generateBikeId();
  toast('Bike registered & saved to Google Sheet!');
  showView('bike-list', null);
}

function saveBike() {
  const plate = (document.getElementById('bf-plate').value || '').trim();
  if (!plate) { toast('Plate number is required.', 'error'); return false; }

  // Ensure Bike ID is set before submission
  const bikeIdEl = document.getElementById('bf-bike-id');
  if (bikeIdEl && !bikeIdEl.value) bikeIdEl.value = generateBikeId();

  const docs = {};
  BIKE_DOCS.forEach(k => docs[k] = !!bikePending[k]);
  bikes.push({
    id: nextBikeId++, plate,
    chassis:    document.getElementById('bf-chassis').value,
    make:       document.getElementById('bf-make').value || '—',
    model:      document.getElementById('bf-model').value || '—',
    emirate:    document.getElementById('bf-emirate').value,
    mulkiyaExp: document.getElementById('bf-mulkiya-exp').value,
    insExp:     document.getElementById('bf-ins-exp').value,
    licExp:     document.getElementById('bf-lic-exp').value,
    docs,
  });
  updateBadges();
  return true;
}

// Wire bikeForm onsubmit — mirrors employeeForm pattern
document.getElementById('bikeForm').onsubmit = function(ev) {
  if (!saveBike()) {
    ev.preventDefault();
    return false;
  }
  isBikeSubmitting = true;
  // Form posts to Google via hidden iframe; clearBikeForm() fires on iframe onload
};

function openBikeEdit(id) {
  const b = bikes.find(x => x.id === id); if (!b) return;
  editBikeId = id;
  document.getElementById('bm-plate').value    = b.plate;
  document.getElementById('bm-makemodel').value= b.make + ' ' + b.model;
  document.getElementById('bm-owner').value    = b.owner;
  document.getElementById('bm-mobile').value   = b.mobile || '';
  document.getElementById('bm-mulkiya').value  = b.mulkiyaExp || '';
  document.getElementById('bm-ins').value      = b.insExp || '';
  document.getElementById('bm-lic').value      = b.licExp || '';
  document.getElementById('bm-fine').value     = b.fine || 0;
  document.getElementById('bm-emirate').value  = b.emirate || 'Dubai';
  document.getElementById('bm-ref').value      = b.ref || '';
  document.getElementById('bike-modal').classList.add('open');
}

function updateBike() {
  const b = bikes.find(x => x.id === editBikeId); if (!b) return;
  b.plate      = document.getElementById('bm-plate').value;
  const mm     = document.getElementById('bm-makemodel').value.split(' ');
  b.make       = mm[0] || b.make;
  b.model      = mm.slice(1).join(' ') || b.model;
  b.owner      = document.getElementById('bm-owner').value;
  b.mobile     = document.getElementById('bm-mobile').value;
  b.mulkiyaExp = document.getElementById('bm-mulkiya').value;
  b.insExp     = document.getElementById('bm-ins').value;
  b.licExp     = document.getElementById('bm-lic').value;
  b.fine       = parseFloat(document.getElementById('bm-fine').value) || 0;
  b.emirate    = document.getElementById('bm-emirate').value;
  b.ref        = document.getElementById('bm-ref').value;
  closeModal('bike-modal'); renderBikeTable(bikes); updateBadges();
  toast('Bike record updated.');
}

function deleteBike() {
  if (!confirm('Delete this bike record? This cannot be undone.')) return;
  bikes = bikes.filter(x => x.id !== editBikeId);
  closeModal('bike-modal'); renderBikeTable(bikes); updateBadges();
  toast('Bike deleted.');
}

let currentDocEntity    = null; // { type:'emp'|'bike', id, key }
let currentDocFileData  = null; // { name, dataUrl }

/* Doc state helpers — docs can be boolean (legacy) or {ok, expiry, notes, file} */
function docObj(docsObj, key) {
  const v = docsObj[key];
  if (!v) return null;
  if (typeof v === 'boolean') return { ok: true };
  return v;
}

const DOC_LABELS = {
  // employee
  pic: 'Personal Photo', labour: 'Labour Card', visa: 'Visa Copy',
  license: 'Trade License', insurance: 'Insurance Card', 'eid-doc': 'Emirates ID Copy',
  // bike
  mulkiya: 'Mulkiya (Reg Card)', inspection: 'RTA Inspection', clearance: 'RTA Fine Clearance',
  photo: 'Bike Photo', purchase: 'Purchase / Ownership Proof',
  eid: 'Emirates ID Copy', licence: 'Driving Licence Copy',
};

function openDocModal(type, id, key) {
  const entity = type === 'emp'
    ? employees.find(x => x.id === id)
    : bikes.find(x => x.id === id);
  if (!entity) return;

  currentDocEntity   = { type, id, key };
  currentDocFileData = null;

  const doc = docObj(entity.docs, key);
  const label = DOC_LABELS[key] || key;

  document.getElementById('doc-modal-title').textContent = label;
  document.getElementById('doc-notes-input').value = doc?.notes || '';
  document.getElementById('doc-expiry-input').value = doc?.expiry || '';
  document.getElementById('doc-filename-display').textContent = doc?.fileName || 'No file selected';

  // Banner
  const state = dotState(entity.docs, key);
  const banner = document.getElementById('doc-status-banner');
  banner.className = 'doc-status-banner ' + state;
  const iconMap = { ok:'ti-circle-check', expiring:'ti-clock', expired:'ti-alert-triangle', miss:'ti-file-off' };
  const textMap = { ok:'Document OK', expiring:'Expiring Soon', expired:'Document Expired', miss:'Document Missing' };
  const subMap  = {
    ok: doc?.expiry ? `Expires ${doc.expiry}` : 'No expiry date set',
    expiring: `Expires ${doc?.expiry} — renewal required`,
    expired:  `Expired ${doc?.expiry} — upload updated document`,
    miss: 'No document has been uploaded yet',
  };
  document.getElementById('doc-status-icon').className = 'ti ' + iconMap[state];
  document.getElementById('doc-status-text').textContent = textMap[state];
  document.getElementById('doc-status-sub').textContent  = subMap[state];

  // Preview
  const preview = document.getElementById('doc-preview-area');
  if (doc?.dataUrl) {
    if (doc.dataUrl.startsWith('data:image')) {
      preview.innerHTML = `<img src="${doc.dataUrl}" alt="Document preview" />`;
    } else {
      preview.innerHTML = `<i class="ti ti-file-description" style="font-size:40px;color:var(--accent);margin-bottom:10px;"></i>
        <div style="font-size:13px;color:var(--text2);font-weight:500;">${doc.fileName}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">PDF document attached</div>`;
    }
  } else {
    preview.innerHTML = `<i class="ti ti-file-off" style="font-size:40px;color:var(--text3);margin-bottom:10px;"></i>
      <div style="font-size:13px;color:var(--text2);font-weight:500;">No document uploaded</div>
      <div style="font-size:12px;color:var(--text3);margin-top:4px;">Upload a file below to attach this document</div>`;
  }

  // Remove btn
  document.getElementById('doc-remove-btn').style.display = doc ? 'inline-flex' : 'none';

  document.getElementById('doc-modal').classList.add('open');
}

function triggerDocUpload() {
  document.getElementById('doc-file-input').click();
}

function handleDocFileSelect(e) {
  if (!e.target.files.length) return;
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = ev => {
    currentDocFileData = { name: file.name, dataUrl: ev.target.result };
    document.getElementById('doc-filename-display').textContent = file.name;
    // Show preview immediately
    const preview = document.getElementById('doc-preview-area');
    if (file.type.startsWith('image/')) {
      preview.innerHTML = `<img src="${ev.target.result}" alt="Preview" />`;
    } else {
      preview.innerHTML = `<i class="ti ti-file-description" style="font-size:40px;color:var(--accent);margin-bottom:10px;"></i>
        <div style="font-size:13px;color:var(--text2);font-weight:500;">${file.name}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">Ready to save</div>`;
    }
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function saveDoc() {
  if (!currentDocEntity) return;
  const { type, id, key } = currentDocEntity;
  const entity = type === 'emp' ? employees.find(x => x.id === id) : bikes.find(x => x.id === id);
  if (!entity) return;

  const expiry = document.getElementById('doc-expiry-input').value;
  const notes  = document.getElementById('doc-notes-input').value;
  const existing = docObj(entity.docs, key) || {};

  entity.docs[key] = {
    ok: true,
    expiry: expiry || existing.expiry || null,
    notes:  notes || existing.notes || '',
    fileName: currentDocFileData ? currentDocFileData.name : (existing.fileName || null),
    dataUrl:  currentDocFileData ? currentDocFileData.dataUrl : (existing.dataUrl || null),
  };

  closeModal('doc-modal');

  // Re-render the right table
  if (type === 'emp') renderEmpTable(employees);
  else renderBikeTable(bikes);
  updateBadges();
  toast('Document saved.');
}

function removeDoc() {
  if (!currentDocEntity) return;
  const { type, id, key } = currentDocEntity;
  const entity = type === 'emp' ? employees.find(x => x.id === id) : bikes.find(x => x.id === id);
  if (!entity) return;
  entity.docs[key] = false;
  closeModal('doc-modal');
  if (type === 'emp') renderEmpTable(employees);
  else renderBikeTable(bikes);
  updateBadges();
  toast('Document removed.');
}

/* ═══════════════════════════════════════════════
   FILE UPLOAD (add/edit forms)
   ═══════════════════════════════════════════════ */
function triggerUpload(type, doc) {
  currentUploadType = type;
  currentUploadDoc  = doc;
  document.getElementById('file-input-' + type).click();
}

function fileUploaded(e, type) {
  if (!e.target.files.length) return;
  const doc = currentUploadDoc;
  if (type === 'e') empPending[doc]  = e.target.files[0].name;
  else              bikePending[doc] = e.target.files[0].name;
  const prefix = type === 'e' ? 'e' : 'b';
  const s = document.getElementById(prefix + 's-' + doc);
  const b = document.getElementById(prefix + 'u-' + doc);
  if (s) { s.textContent = 'Uploaded'; s.className = 'upload-status uploaded'; }
  if (b) b.classList.add('done');
  e.target.value = '';
}

/* ═══════════════════════════════════════════════
   MODAL
   ═══════════════════════════════════════════════ */
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// Close modal on backdrop click
document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) backdrop.classList.remove('open');
  });
});

// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop.open').forEach(m => m.classList.remove('open'));
  }
});

/* ═══════════════════════════════════════════════
   FLEET CHECKOUT MODULE
   ═══════════════════════════════════════════════ */
const CO_STORE = {
  get(k)    { try { const r = localStorage.getItem('bks_' + k); return r ? JSON.parse(r) : null; } catch(e) { return null; } },
  set(k, v) { try { localStorage.setItem('bks_' + k, JSON.stringify(v)); } catch(e) {} },
};

let coBikes = [], coEmployees = [], coTransactions = [];
let coLoaded = false;

function coLoad() {
  if (coLoaded) return;
  coBikes        = CO_STORE.get('bikes')        || [];
  coEmployees    = CO_STORE.get('employees')    || [];
  coTransactions = CO_STORE.get('transactions') || [];
  if (!coBikes.length && !coEmployees.length) {
    coBikes = [
      { id:'B-001', desc:'Trek FX3 - Blue',            status:'available', trips:0 },
      { id:'B-002', desc:'Giant Escape - Red',          status:'available', trips:0 },
      { id:'B-003', desc:'Cannondale Quick - Black',    status:'available', trips:0 },
      { id:'B-004', desc:'Specialized Sirrus - White',  status:'available', trips:0 },
      { id:'B-005', desc:'Trek Marlin 5 - Green',       status:'available', trips:0 },
    ];
    coEmployees = [
      { id:'EMP-001', name:'Ahmed Al Rashid',  dept:'Operations',  trips:0 },
      { id:'EMP-002', name:'Sara Mohammed',    dept:'Logistics',   trips:0 },
      { id:'EMP-003', name:'Ravi Kumar',       dept:'Maintenance', trips:0 },
      { id:'EMP-004', name:'Fatima Al Zaabi',  dept:'Admin',       trips:0 },
      { id:'EMP-005', name:'James Okafor',     dept:'Security',    trips:0 },
    ];
    coSave();
  }
  coLoaded = true;
}

function coSave() {
  CO_STORE.set('bikes',        coBikes);
  CO_STORE.set('employees',    coEmployees);
  CO_STORE.set('transactions', coTransactions);
}

/* ─── Helpers ─── */
function coActiveFor(bikeId)   { return coTransactions.find(t => t.bikeId === bikeId && t.status === 'active'); }
function coActiveForEmp(empId) { return coTransactions.filter(t => t.empId === empId  && t.status === 'active'); }
function coNowStr()            { return new Date().toISOString().slice(0, 16); }

function coFmtDT(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
       + ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
}

function coDuration(start, end) {
  const s = new Date(start), e = end ? new Date(end) : new Date();
  const m = Math.floor((e - s) / 60000);
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function coShowAlert(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  const bg  = type === 'red' ? 'var(--red-dim)'  : 'var(--teal-dim)';
  const bd  = type === 'red' ? 'rgba(248,81,73,.25)' : 'rgba(57,211,83,.25)';
  const fg  = type === 'red' ? 'var(--red)'  : 'var(--teal)';
  el.innerHTML = `<div style="padding:10px 14px;border-radius:var(--radius);font-size:13px;margin-bottom:12px;background:${bg};border:1px solid ${bd};color:${fg};">${msg}</div>`;
  setTimeout(() => { if (el) el.innerHTML = ''; }, 3500);
}

/* ─── Check Out form ─── */
function coRefreshForm() {
  const sel = document.getElementById('co-bike');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select Bike —</option>';
  coBikes.filter(b => b.status === 'available').forEach(b => {
    const o = document.createElement('option');
    o.value = b.id;
    o.textContent = b.id + ' — ' + b.desc;
    sel.appendChild(o);
  });
  sel.value = cur;
  const ts = document.getElementById('co-time');
  const autoTs = document.getElementById('co-set-autots');
  if (ts && autoTs && autoTs.checked) ts.value = coNowStr();
}

function coSearchEmp() {
  const q  = (document.getElementById('co-emp-input').value || '').toLowerCase();
  const dd = document.getElementById('co-emp-dd');
  // Only show enabled riders (checked in Manage Fleet)
  const matches = coEmployees.filter(e =>
    e.enabled !== false &&
    (e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)));
  dd.innerHTML = '';
  if (!matches.length) { dd.classList.remove('open'); return; }
  matches.forEach(e => {
    const d = document.createElement('div');
    d.className = 'co-dd-item';
    d.innerHTML = `<strong>${e.id}</strong> — ${e.name} <span style="color:var(--text3);font-size:11px;">(${e.dept || ''})</span>`;
    d.onclick = () => {
      document.getElementById('co-emp-input').value = e.id + ' — ' + e.name;
      document.getElementById('co-emp-id').value    = e.id;
      document.getElementById('co-emp-name').value  = e.name;
      dd.classList.remove('open');
    };
    dd.appendChild(d);
  });
  dd.classList.add('open');
}

document.addEventListener('click', e => {
  const dd = document.getElementById('co-emp-dd');
  if (dd && !dd.parentElement.contains(e.target)) dd.classList.remove('open');
});

function coDoCheckout() {
  const bikeId  = document.getElementById('co-bike').value;
  const empId   = document.getElementById('co-emp-id').value;
  const empName = document.getElementById('co-emp-name').value;
  const coTime  = document.getElementById('co-time').value;
  const notes   = document.getElementById('co-notes').value;

  if (!bikeId)  { coShowAlert('co-alert', 'Please select a bike.', 'red');       return; }
  if (!empId)   { coShowAlert('co-alert', 'Please select an employee.', 'red');   return; }
  if (!coTime)  { coShowAlert('co-alert', 'Checkout time is required.', 'red');   return; }

  const reqNotes = document.getElementById('co-set-regnotes');
  if (reqNotes && reqNotes.checked && !notes) {
    coShowAlert('co-alert', 'Notes are required (see Settings).', 'red'); return;
  }

  const bike = coBikes.find(b => b.id === bikeId);
  if (!bike || bike.status !== 'available') {
    coShowAlert('co-alert', 'This bike is already checked out.', 'red'); return;
  }

  const noDupe = document.getElementById('co-set-nodupe');
  if (noDupe && noDupe.checked && coActiveForEmp(empId).length > 0) {
    coShowAlert('co-alert', 'Employee already has an active checkout. Return current bike first.', 'red'); return;
  }

  const txn = {
    id: 'TXN-' + Date.now(), bikeId, bikeName: bike.desc,
    empId, empName, checkoutTime: coTime, checkinTime: null, notes, status: 'active',
  };
  coTransactions.push(txn);
  bike.status   = 'checked-out';
  bike.trips    = (bike.trips || 0) + 1;
  const emp = coEmployees.find(e => e.id === empId);
  if (emp) emp.trips = (emp.trips || 0) + 1;

  coSave();
  document.getElementById('co-bike').value      = '';
  document.getElementById('co-emp-input').value = '';
  document.getElementById('co-emp-id').value    = '';
  document.getElementById('co-emp-name').value  = '';
  document.getElementById('co-notes').value     = '';
  coRefreshForm();
  coShowAlert('co-alert', 'Bike checked out successfully!', 'green');
  toast('Bike ' + bikeId + ' checked out to ' + empId);
}

/* ─── Check In (Return) ─── */
function coDoCheckin(txnId) {
  const txn = coTransactions.find(t => t.id === txnId);
  if (!txn) return;
  txn.status      = 'returned';
  txn.checkinTime = new Date().toISOString().slice(0, 16);
  const bike = coBikes.find(b => b.id === txn.bikeId);
  if (bike) bike.status = 'available';
  coSave();
  coRenderCheckin();
  toast(txn.bikeId + ' returned successfully');
}

function coRenderCheckin() {
  const tbody = document.getElementById('co-ci-table');
  if (!tbody) return;
  const q = ((document.getElementById('co-ci-search') || {}).value || '').toLowerCase();
  const active = coTransactions.filter(t =>
    t.status === 'active' &&
    (!q || (t.bikeId + t.bikeName + t.empId + t.empName).toLowerCase().includes(q)));
  if (!active.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3);"><i class="ti ti-circle-check" style="font-size:24px;display:block;margin:0 auto 8px;color:var(--teal);"></i>No bikes currently checked out.</td></tr>';
    return;
  }
  tbody.innerHTML = active.map(t => `<tr>
    <td style="font-weight:500;color:var(--amber);">${t.bikeId}
      <div style="font-size:11px;color:var(--text3);">${t.bikeName}</div>
    </td>
    <td>${t.empName}</td>
    <td style="font-family:var(--mono);font-size:12px;color:var(--accent);">${t.empId}</td>
    <td style="font-size:12px;">${coFmtDT(t.checkoutTime)}</td>
    <td><button class="action-btn" onclick="coDoCheckin('${t.id}')"><i class="ti ti-arrow-back-up"></i> Return</button></td>
  </tr>`).join('');
}

/* ─── Active checkouts ─── */
function coRenderActive() {
  const q = ((document.getElementById('co-a-search') || {}).value || '').toLowerCase();
  const active = coTransactions.filter(t =>
    t.status === 'active' &&
    (!q || (t.bikeId + t.bikeName + t.empId + t.empName).toLowerCase().includes(q)));
  const tbody = document.getElementById('co-a-table');
  if (tbody) {
    if (!active.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text3);">No active checkouts.</td></tr>';
    } else {
      tbody.innerHTML = active.map(t => `<tr>
        <td>
          <div style="font-weight:500;">${t.bikeId}</div>
          <div style="font-size:11px;color:var(--text3);">${t.bikeName}</div>
        </td>
        <td>${t.empName}</td>
        <td style="font-family:var(--mono);font-size:12px;color:var(--accent);">${t.empId}</td>
        <td style="font-size:12px;">${coFmtDT(t.checkoutTime)}</td>
        <td><span class="badge expiring">${coDuration(t.checkoutTime)}</span></td>
        <td style="color:var(--text3);font-size:12px;">${t.notes || '—'}</td>
        <td><button class="action-btn" onclick="coDoCheckinFromActive('${t.id}')"><i class="ti ti-arrow-back-up"></i> Return</button></td>
      </tr>`).join('');
    }
  }

  const avail = coBikes.filter(b => b.status === 'available');
  const avEl  = document.getElementById('co-avail-list');
  if (!avEl) return;
  avEl.innerHTML = avail.length
    ? '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;">' +
      avail.map(b => `
        <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:10px 12px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="width:8px;height:8px;border-radius:50%;background:var(--teal);display:inline-block;flex-shrink:0;"></span>
            <strong style="font-size:13px;">${b.id}</strong>
          </div>
          <div style="font-size:11px;color:var(--text3);margin-top:3px;">${b.desc}</div>
        </div>`).join('') + '</div>'
    : '<div style="text-align:center;padding:24px;color:var(--text3);font-size:13px;">No bikes available right now.</div>';
}

function coDoCheckinFromActive(txnId) {
  const txn = coTransactions.find(t => t.id === txnId);
  if (!txn) return;
  txn.status      = 'returned';
  txn.checkinTime = new Date().toISOString().slice(0, 16);
  const bike = coBikes.find(b => b.id === txn.bikeId);
  if (bike) bike.status = 'available';
  coSave();
  coRenderActive();
  coRenderHistory();
  toast(txn.bikeId + ' returned successfully');
}

/* ─── History ─── */
function coRenderHistory() {
  const q  = ((document.getElementById('co-h-search') || {}).value || '').toLowerCase();
  const sf = (document.getElementById('co-h-status')  || {}).value || '';
  const data = [...coTransactions].reverse().filter(t =>
    (!sf || t.status === sf) &&
    (!q  || (t.bikeId + t.bikeName + t.empId + t.empName).toLowerCase().includes(q)));
  const tbody = document.getElementById('co-h-table');
  if (!tbody) return;
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:32px;color:var(--text3);">No records found.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(t => `<tr>
    <td style="font-weight:500;">${t.bikeId}
      <div style="font-size:11px;color:var(--text3);">${t.bikeName}</div>
    </td>
    <td>${t.empName}</td>
    <td style="font-family:var(--mono);font-size:12px;color:var(--accent);">${t.empId}</td>
    <td style="font-size:12px;">${coFmtDT(t.checkoutTime)}</td>
    <td style="font-size:12px;">${t.checkinTime ? coFmtDT(t.checkinTime) : '<span style="color:var(--amber)">—</span>'}</td>
    <td>${coDuration(t.checkoutTime, t.checkinTime)}</td>
    <td>${t.status === 'returned'
      ? '<span class="badge active">Returned</span>'
      : '<span class="badge expiring">Active</span>'}</td>
  </tr>`).join('');
}

/* ─── Fleet management ─── */
function coRenderFleet() {
  const tbody = document.getElementById('co-fleet-table');
  if (!tbody) return;
  const q = ((document.getElementById('co-fleet-search') || {}).value || '').toLowerCase();
  const data = coBikes.filter(b => !q || (b.id + b.desc).toLowerCase().includes(q));
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:32px;color:var(--text3);">No bikes in fleet.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(b => `<tr>
    <td style="font-weight:500;font-family:var(--mono);font-size:12px;">${b.id}</td>
    <td>${b.desc}</td>
    <td>${b.status === 'available'
      ? '<span class="badge active">Available</span>'
      : '<span class="badge expiring">Checked Out</span>'}</td>
    <td style="color:var(--text3);">${b.trips || 0}</td>
    <td>${b.status === 'available'
      ? `<button class="action-btn" onclick="coRemoveBike('${b.id}')"><i class="ti ti-trash"></i></button>`
      : '<span style="color:var(--text3);font-size:11px;">In Use</span>'}</td>
  </tr>`).join('');
}

function coAddBike() {
  const id   = (document.getElementById('co-new-bike-id').value   || '').trim();
  const desc = (document.getElementById('co-new-bike-desc').value  || '').trim();
  if (!id) { toast('Enter a Bike ID.'); return; }
  if (coBikes.find(b => b.id === id)) { toast('Bike ID already exists.'); return; }
  coBikes.push({ id, desc: desc || id, status: 'available', trips: 0 });
  coSave(); coRenderFleet(); coRefreshForm();
  document.getElementById('co-new-bike-id').value  = '';
  document.getElementById('co-new-bike-desc').value = '';
  toast('Bike ' + id + ' added.');
}

function coRemoveBike(id) {
  const bike = coBikes.find(b => b.id === id);
  if (!bike || bike.status !== 'available') { toast('Cannot remove a checked-out bike.'); return; }
  coBikes = coBikes.filter(b => b.id !== id);
  coSave(); coRenderFleet(); coRefreshForm();
  toast('Bike removed.');
}

/* ─── Employee management ─── */
function coRenderEmpTable() {
  const tbody = document.getElementById('co-emp-table');
  if (!tbody) return;
  const q = ((document.getElementById('co-emp-search') || {}).value || '').toLowerCase();
  const data = coEmployees.filter(e => !q || (e.id + e.name + (e.dept||'')).toLowerCase().includes(q));
  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text3);">No employees.</td></tr>';
    return;
  }
  tbody.innerHTML = data.map(e => `<tr>
    <td><input type="checkbox" class="rider-cb" data-id="${e.id}" ${e.enabled !== false ? 'checked' : ''}
      style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);" /></td>
    <td style="font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:500;">${e.id}</td>
    <td>${e.name}</td>
    <td style="color:var(--text3);">${e.dept || '—'}</td>
    <td style="color:var(--text3);">${e.trips || 0}</td>
    <td>${coActiveForEmp(e.id).length === 0
      ? `<button class="action-btn" onclick="coRemoveEmp('${e.id}')"><i class="ti ti-trash"></i></button>`
      : '<span style="color:var(--amber);font-size:11px;">Active</span>'}</td>
  </tr>`).join('');
  // sync select-all checkbox
  const allCbs = tbody.querySelectorAll('.rider-cb');
  const allChecked = [...allCbs].every(c => c.checked);
  const selAll = document.getElementById('co-emp-select-all');
  if (selAll) selAll.checked = allChecked && allCbs.length > 0;
}

function coAddEmployee() {
  const id   = (document.getElementById('co-new-emp-id').value   || '').trim();
  const name = (document.getElementById('co-new-emp-name').value  || '').trim();
  const dept = (document.getElementById('co-new-emp-dept').value  || '').trim();
  if (!id || !name) { toast('EMP ID and Name are required.'); return; }
  if (coEmployees.find(e => e.id === id)) { toast('EMP ID already exists.'); return; }
  coEmployees.push({ id, name, dept, trips: 0 });
  coSave(); coRenderEmpTable();
  document.getElementById('co-new-emp-id').value   = '';
  document.getElementById('co-new-emp-name').value = '';
  document.getElementById('co-new-emp-dept').value = '';
  toast('Employee ' + id + ' added.');
}

function coRemoveEmp(id) {
  if (coActiveForEmp(id).length > 0) { toast('Employee has active checkout.'); return; }
  coEmployees = coEmployees.filter(e => e.id !== id);
  coSave(); coRenderEmpTable();
  toast('Employee removed.');
}

/* ─── Clear all ─── */
function coConfirmClear() { document.getElementById('co-modal-clear').classList.add('open'); }
function coClearAll() {
  coTransactions = [];
  coBikes.forEach(b => b.status = 'available');
  coEmployees.forEach(e => e.trips = 0);
  coSave();
  closeModal('co-modal-clear');
  toast('All checkout records cleared.');
}


/* ─── Tab switching (Active & History combined view) ─── */
function coSwitchTab(tab) {
  const activePanel  = document.getElementById('co-panel-active');
  const histPanel    = document.getElementById('co-panel-history');
  const tabActive    = document.getElementById('tab-active');
  const tabHistory   = document.getElementById('tab-history');
  if (tab === 'active') {
    activePanel.style.display = '';
    histPanel.style.display   = 'none';
    tabActive.classList.add('active');
    tabHistory.classList.remove('active');
    coRenderActive();
  } else {
    activePanel.style.display = 'none';
    histPanel.style.display   = '';
    tabHistory.classList.add('active');
    tabActive.classList.remove('active');
    coRenderHistory();
  }
}

/* ─── Rider checkbox selection ─── */
function coToggleAllRiders(cb) {
  document.querySelectorAll('.rider-cb').forEach(c => c.checked = cb.checked);
}

function coSaveRiderSelection() {
  document.querySelectorAll('.rider-cb').forEach(cb => {
    const emp = coEmployees.find(e => e.id === cb.dataset.id);
    if (emp) emp.enabled = cb.checked;
  });
  coSave();
  coRefreshForm();
  toast('Rider selection saved. Checkout list updated.');
}

/* ─── Sheet import / fetch ─── */
function coFetchFromSheet() {
  const panel = document.getElementById('co-fetch-preview');
  if (panel) panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function coImportSheet() {
  const raw = (document.getElementById('co-sheet-input').value || '').trim();
  if (!raw) { toast('Paste some data first.', 'error'); return; }
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  let added = 0, skipped = 0;
  lines.forEach(line => {
    // Support tab or comma separated
    const cols = line.split(/\t|,/).map(c => c.trim());
    const [id, name, dept] = cols;
    if (!id || !name) { skipped++; return; }
    if (coEmployees.find(e => e.id === id)) { skipped++; return; }
    coEmployees.push({ id, name, dept: dept || '', trips: 0, enabled: true });
    added++;
  });
  coSave();
  coRenderEmpTable();
  document.getElementById('co-sheet-input').value = '';
  document.getElementById('co-fetch-preview').style.display = 'none';
  toast(`Imported ${added} rider(s). ${skipped ? skipped + ' skipped (duplicate/invalid).' : ''}`);
}

document.addEventListener('DOMContentLoaded', () => {
  // Inject spinner keyframe if not already in stylesheet
  if (!document.getElementById('spin-style')) {
    const s = document.createElement('style');
    s.id = 'spin-style';
    s.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
    document.head.appendChild(s);
  }

  renderDashboard();
  updateBadges();
  document.querySelectorAll('.nav-sub').forEach(s => s.classList.remove('open'));
  document.querySelectorAll('.nav-parent').forEach(p => p.classList.remove('open'));
  loadEmployees();
  loadBikes();

  // Restore saved theme
  const saved = localStorage.getItem('theme') || 'dark';
  setTheme(saved, false);
});

function setTheme(mode, save = true) {
  document.documentElement.setAttribute('data-theme', mode);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.className = mode === 'light' ? 'ti ti-moon' : 'ti ti-sun';
  if (save) localStorage.setItem('theme', mode);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  setTheme(current === 'dark' ? 'light' : 'dark');
}


/* ── EID auto-format + gen-id fill ── */
const eidInput   = document.getElementById('ef-eid');
const genIdInput = document.getElementById('ef-gen-id');

if (eidInput && genIdInput) {
  eidInput.addEventListener('input', function() {
    // Auto-format: keep only digits then insert dashes at 3/7/14
    let digits = eidInput.value.replace(/\D/g, '');
    let fmt = digits.substring(0,3);
    if (digits.length > 3)  fmt += '-' + digits.substring(3,7);
    if (digits.length > 7)  fmt += '-' + digits.substring(7,14);
    if (digits.length > 14) fmt += '-' + digits.substring(14,15);
    eidInput.value = fmt;

    // Fill gen-id with last 8 digits
    genIdInput.value = digits.length >= 8 ? digits.slice(-8) : '';
  });
}

/* ── Field validation helpers ── */
function showFieldError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = 'var(--red)';
  let e = el.parentElement.querySelector('.field-err');
  if (!e) { e = document.createElement('div'); e.className = 'field-err'; el.parentElement.appendChild(e); }
  e.textContent = msg;
}
function clearFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.borderColor = '';
  el.parentElement.querySelector('.field-err')?.remove();
}
function clearAllErrors() {
  ['ef-name','ef-eid','ef-dob','ef-mobile','ef-emergency','ef-ref',
   'ef-eid-exp','ef-license-exp','ef-labour-exp','ef-insurance-exp'].forEach(clearFieldError);
}

// Clear error on input
['ef-name','ef-eid','ef-dob','ef-mobile','ef-emergency','ef-ref',
 'ef-eid-exp','ef-license-exp','ef-labour-exp','ef-insurance-exp'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => clearFieldError(id));
});

function validateEmpForm() {
  clearAllErrors();
  let valid = true;
  const todayDate = new Date(); todayDate.setHours(0,0,0,0);

  // Name
  const name = (document.getElementById('ef-name')?.value || '').trim();
  if (!name) { showFieldError('ef-name', 'Full name is required.'); valid = false; }

  // EID: 784-XXXX-XXXXXXX-X
  const eid = (document.getElementById('ef-eid')?.value || '').trim();
  if (!eid) { showFieldError('ef-eid', 'Emirates ID is required.'); valid = false; }
  else if (!/^784-\d{4}-\d{7}-\d$/.test(eid)) { showFieldError('ef-eid', 'Must be: 784-XXXX-XXXXXXX-X'); valid = false; }

  // DOB — min 18 years old
  const dobVal = document.getElementById('ef-dob')?.value;
  if (!dobVal) { showFieldError('ef-dob', 'Date of birth is required.'); valid = false; }
  else {
    const dob = new Date(dobVal);
    const min18 = new Date(todayDate); min18.setFullYear(min18.getFullYear() - 18);
    if (dob > min18) { showFieldError('ef-dob', 'Employee must be at least 18 years old.'); valid = false; }
  }

  // UAE Mobile: +971 5X or 05X format
  const mob = (document.getElementById('ef-mobile')?.value || '').trim().replace(/\s/g,'');
  if (!mob) { showFieldError('ef-mobile', 'UAE mobile is required.'); valid = false; }
  else if (!/^(\+971|00971|0)5[0-9]\d{7}$/.test(mob)) {
    showFieldError('ef-mobile', 'Enter valid UAE mobile: +971 5X XXX XXXX or 05X XXX XXXX'); valid = false;
  }

  // Emergency
  const emg = (document.getElementById('ef-emergency')?.value || '').trim();
  if (!emg) { showFieldError('ef-emergency', 'Emergency contact is required.'); valid = false; }

  // Reference
  const ref = (document.getElementById('ef-ref')?.value || '').trim();
  if (!ref) { showFieldError('ef-ref', 'Reference / company is required.'); valid = false; }

  // Expiry dates must be > today
  [
    { id:'ef-eid-exp',       label:'EID expiry' },
    { id:'ef-license-exp',   label:'License expiry' },
    { id:'ef-labour-exp',    label:'Labour card expiry' },
    { id:'ef-insurance-exp', label:'Insurance expiry' },
  ].forEach(({ id, label }) => {
    const v = document.getElementById(id)?.value;
    if (v) {
      const d = new Date(v); d.setHours(0,0,0,0);
      if (d <= todayDate) { showFieldError(id, `${label} must be a future date.`); valid = false; }
    }
  });

  return valid;
}

let isSubmitting = false;
document.getElementById('employeeForm').onsubmit = function(ev) {
  if (!validateEmpForm()) {
    ev.preventDefault();
    toast('Please fix the errors before saving.', 'error');
    return false;
  }
  isSubmitting = true;
};

function clearForm() {
  if (isSubmitting) {
    clearAllErrors();
    document.getElementById('employeeForm').reset();
    if (genIdInput) genIdInput.value = '';
    isSubmitting = false;
    toast('Employee saved successfully!');
  }
}

/* ── HR filter is now defined in the EMPLOYEE TABLE section above ── */
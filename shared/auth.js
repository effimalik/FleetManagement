/* ═══════════════════════════════════════════════════════════════
   auth.js — AdminPro UAE
   v2.0 — Server-validated sessions, token-gated API credentials,
           absolute + inactivity expiry, secure logout
   Load FIRST on every page (before dataLayer.js and any page JS)
═══════════════════════════════════════════════════════════════ */
'use strict';

(function () {

  /* ─────────────────────────────────────────
     CONSTANTS
  ───────────────────────────────────────── */
  const SESSION_KEY      = 'ap_session';          // sessionStorage key
  const INACTIVITY_TTL   = 30 * 60 * 1000;        // 30 min idle → logout
  const ABSOLUTE_TTL     = 8  * 60 * 60 * 1000;   // 8 hr hard limit regardless of activity
  const SERVER_CHECK_INT = 5  * 60 * 1000;         // re-validate with server every 5 min
  const ALLOWED_ORIGIN   = 'https://effimalik.github.io/FleetManagement/';
  const API_BASE         = 'https://script.google.com/macros/s/AKfycbyOkXshkQIhwtBjNcDbtQCsU4t6_WlH5aii6O6xElMuQa1ZB4Fn9E31c4NoO-au8TXCEw/exec';

  /* ─────────────────────────────────────────
     INTERNAL HELPERS
  ───────────────────────────────────────── */

  /** Read raw session object from sessionStorage. Never throws. */
  function _readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Write session object back to sessionStorage. Never throws. */
  function _writeSession(s) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
  }

  /** Wipe sessionStorage and redirect to login, preserving return URL. */
  function _redirectToLogin(reason) {
    console.warn('[Auth] Redirecting to login —', reason || 'session invalid');
    sessionStorage.removeItem(SESSION_KEY);
    document.documentElement.style.visibility = 'hidden';
    const next = encodeURIComponent(window.location.href);
    window.location.replace(ALLOWED_ORIGIN + 'login.html?next=' + next);
  }

  /** Pure client-side fast-fail: checks structure, inactivity, and absolute TTL.
      Does NOT contact the server — used for immediate page-load gate only. */
  function _isClientValid(s) {
    if (!s)                        return false;
    if (!s.sessionId || !s.token) return false;   // must have both credentials
    if (!s.email)                  return false;   // basic identity present
    if (!s.loginAt)                return false;   // must know when session started

    const now = Date.now();
    if (s.lastActive && now - s.lastActive > INACTIVITY_TTL) return false;
    if (now - s.loginAt > ABSOLUTE_TTL)                      return false;
    return true;
  }

  /* ─────────────────────────────────────────
     SERVER VALIDATION
     Sends sessionId + token to Apps Script.
     Apps Script must return { valid: true/false, reason?: string }
     Called: on page load (after client check passes) + every SERVER_CHECK_INT
  ───────────────────────────────────────── */
  let _serverCheckTimer = null;

  async function _validateWithServer() {
    const s = _readSession();
    if (!_isClientValid(s)) { _redirectToLogin('client check failed before server call'); return; }

    try {
      const url = `${API_BASE}?type=validateSession&sessionId=${encodeURIComponent(s.sessionId)}&token=${encodeURIComponent(s.token)}&t=${Date.now()}`;
      const res  = await fetch(url, { cache: 'no-store' });
      const data = await res.json();

      if (!data.valid) {
        _redirectToLogin('server rejected session: ' + (data.reason || 'unknown'));
        return;
      }

      /* Server confirmed — update lastActive */
      s.lastActive = Date.now();
      _writeSession(s);

    } catch (e) {
      /* Network failure: do NOT log out — could be transient.
         Client-side TTL remains the safety net. Log and continue. */
      console.warn('[Auth] Server validation network error (kept session):', e.message);
    }

    /* Schedule next check */
    _scheduleServerCheck();
  }

  function _scheduleServerCheck() {
    if (_serverCheckTimer) clearTimeout(_serverCheckTimer);
    _serverCheckTimer = setTimeout(_validateWithServer, SERVER_CHECK_INT);
  }

  /* ─────────────────────────────────────────
     INACTIVITY TIMER
  ───────────────────────────────────────── */
  let _idleTimer = null;

  function _resetIdle() {
    const s = _readSession();
    if (!s) { _redirectToLogin('no session on idle reset'); return; }
    if (!_isClientValid(s)) { _redirectToLogin('session expired on idle reset'); return; }

    s.lastActive = Date.now();
    _writeSession(s);

    if (_idleTimer) clearTimeout(_idleTimer);
    _idleTimer = setTimeout(() => _redirectToLogin('inactivity timeout'), INACTIVITY_TTL);
  }

  function _startIdleWatcher() {
    ['mousemove','mousedown','keydown','touchstart','scroll','click']
      .forEach(evt => document.addEventListener(evt, _resetIdle, { passive: true }));
    _idleTimer = setTimeout(() => _redirectToLogin('inactivity timeout'), INACTIVITY_TTL);
  }

  /* ─────────────────────────────────────────
     BOOT — runs immediately when script loads
  ───────────────────────────────────────── */
  (function _boot() {
    /* Skip guard on login page itself — no session exists yet */
    if (window.location.pathname.includes('login.html')) return;

    const s = _readSession();

    /* Fast client-side gate — hide page instantly if obviously invalid */
    if (!_isClientValid(s)) {
      _redirectToLogin('client validation failed on boot');
      return;
    }

    /* Page is safe to show — reveal it */
    document.documentElement.style.visibility = '';

    /* Start activity watcher */
    _startIdleWatcher();

    /* Kick off server validation (async — page loads optimistically) */
    _validateWithServer();

    /* Populate UI chip once DOM is ready */
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _populateUserChip);
    } else {
      _populateUserChip();
    }
  })();

  /* ─────────────────────────────────────────
     USER CHIP RENDERER
  ───────────────────────────────────────── */
  function _populateUserChip() {
    const s = _readSession();
    if (!s || !s.email) return;

    const parts    = (s.name || s.email).trim().split(/\s+/);
    const initials = parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (s.name || s.email).substring(0, 2).toUpperCase();

    const avatar = document.getElementById('tb-avatar');
    const nameEl = document.getElementById('tb-uname');
    const roleEl = document.getElementById('tb-urole');
    const chip   = document.getElementById('tb-user-chip');

    if (avatar) avatar.textContent = initials;
    if (nameEl) nameEl.textContent = s.name || s.email;
    if (roleEl) roleEl.textContent = s.role || 'User';   // display only — never used for access decisions

    if (chip) {
      chip.title   = `Signed in as ${s.email}\nClick to sign out`;
      chip.onclick = () => { if (confirm(`Sign out ${s.name || s.email}?`)) window.Auth.signOut(); };
      chip.style.cursor = 'pointer';
    }
  }

  /* ─────────────────────────────────────────
     PUBLIC API  — window.Auth
     All public methods live here.
     dataLayer.js must use Auth.getCredentials() for every request.
  ───────────────────────────────────────── */
  window.Auth = {

    /**
     * Returns { sessionId, token } for attaching to API calls.
     * Returns null if session is invalid — caller must abort the request.
     * NEVER returns email / role / userId — those are not for client use.
     */
    getCredentials() {
      const s = _readSession();
      if (!_isClientValid(s)) return null;
      return { sessionId: s.sessionId, token: s.token };
    },

    /**
     * Full check: client validity + optional server ping.
     * Resolves true/false. Does NOT redirect — caller decides.
     * Use for pre-flight checks in dataLayer before cache/API access.
     */
    async isAuthenticated() {
      const s = _readSession();
      if (!_isClientValid(s)) return false;
      /* Trust recent server check — don't re-ping every call */
      return true;
    },

    /**
     * Returns display-safe user info.
     * NEVER use this for access control — always go to server.
     */
    getUser() {
      try {
        const s = _readSession();
        if (!s) return {};
        return {
          name    : s.name   || s.email || '',
          email   : s.email  || '',
          role    : s.role   || 'User',   // display only
          initials: (() => {
            const p = (s.name || s.email || '').trim().split(/\s+/);
            return p.length >= 2
              ? (p[0][0] + p[p.length-1][0]).toUpperCase()
              : (s.name || s.email || '??').substring(0,2).toUpperCase();
          })(),
        };
      } catch { return {}; }
    },

    /**
     * Secure logout:
     *  1. Tell server to destroy the session
     *  2. Stop all timers
     *  3. Clear sessionStorage
     *  4. Redirect to login
     *  Cache (localStorage fleet_cache_v1) is kept for next login.
     */
    async signOut() {
      const s = _readSession();

      /* Stop timers first */
      if (_idleTimer)        clearTimeout(_idleTimer);
      if (_serverCheckTimer) clearTimeout(_serverCheckTimer);

      /* Tell server to destroy session — best-effort, don't block logout */
      if (s && s.sessionId && s.token) {
        try {
          await fetch(`${API_BASE}?type=destroySession`, {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({ sessionId: s.sessionId, token: s.token }),
          });
        } catch (e) {
          console.warn('[Auth] signOut server call failed (continuing):', e.message);
        }
      }

      /* Wipe client session */
      sessionStorage.removeItem(SESSION_KEY);

      /* Stop dataLayer refresh timers if loaded */
      if (window.DataLayer && typeof DataLayer.stopAllTimers === 'function') {
        DataLayer.stopAllTimers();
      }

      /* Redirect */
      window.location.replace(ALLOWED_ORIGIN + 'login.html');
    },

    /**
     * Called by login.html after Apps Script verifies credentials.
     * Stores only sessionId + token + minimal display info.
     * login.html receives { sessionId, token, name, email, role } from Apps Script.
     */
    createSession(payload) {
      if (!payload.sessionId || !payload.token || !payload.email) {
        console.error('[Auth] createSession: incomplete payload');
        return false;
      }
      const s = {
        sessionId  : payload.sessionId,
        token      : payload.token,
        email      : payload.email,
        name       : payload.name  || payload.email,
        role       : payload.role  || 'User',   // stored for display ONLY
        loginAt    : Date.now(),
        lastActive : Date.now(),
      };
      _writeSession(s);
      return true;
    },

  };

  /* Legacy shims — keep old callers working */
  window.signOut  = () => window.Auth.signOut();
  window.logout   = () => window.Auth.signOut();
  window.getUser  = () => window.Auth.getUser();

  /* ─────────────────────────────────────────
     LOGIN PAGE REDIRECT HELPER
     Called by login.html after session is created.
  ───────────────────────────────────────── */
  window.handleLoginRedirect = function () {
    try {
      const params = new URLSearchParams(window.location.search);
      const next   = params.get('next');
      if (next && next.startsWith(ALLOWED_ORIGIN)) {
        window.location.replace(next);
      } else {
        window.location.replace(ALLOWED_ORIGIN + 'index.html');
      }
    } catch {
      window.location.replace(ALLOWED_ORIGIN + 'index.html');
    }
  };

})();

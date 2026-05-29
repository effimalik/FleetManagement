/* ═══════════════════════════════════════════════════════════════
   auth.js — AdminPro UAE
   Single unified auth guard for ALL protected pages.

   HOW TO USE — add ONE line inside <head> of every protected page:
     <script src="auth.js"></script>           ← root folder
     <script src="../auth.js"></script>         ← one folder deep
     <script src="../../auth.js"></script>      ← two folders deep

   What this script does automatically:
     1. Blocks access if no valid session → redirects to login.html
     2. Auto-logs out after 30 min of inactivity
     3. Populates the user chip (name, role, initials) on DOMContentLoaded
     4. Exposes signOut(), getUser(), and handleLoginRedirect() globally

   ON YOUR LOGIN PAGE — call this after a successful login:
     handleLoginRedirect();
     → Reads ?next= from the URL and sends the user back to where
       they came from, or falls back to DEFAULT_PAGE.
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ─────────────────────────────────────────────
     CONFIG
  ───────────────────────────────────────────── */
  const SESSION_KEY    = 'ap_user';                                        // sessionStorage key
  const INACTIVITY_TTL = 30 * 60 * 1000;                                  // 30 minutes in ms
  const ALLOWED_ORIGIN = 'https://effimalik.github.io/FleetManagement/';   // your GitHub Pages base URL
  const DEFAULT_PAGE   = ALLOWED_ORIGIN + 'index.html';                  // fallback after login


  /* ─────────────────────────────────────────────
     1. RESOLVE login.html PATH
        Works at any subfolder depth by reading the
        src attribute of this very <script> tag.
  ───────────────────────────────────────────── */
  function getLoginUrl() {
    const scripts = document.querySelectorAll('script[src]');
    for (const s of scripts) {
      if (s.src && s.src.includes(ALLOWED_ORIGIN + 'shered/auth.js')) {
        return s.src.replace(ALLOWED_ORIGIN + 'shared/auth.js', ALLOWED_ORIGIN + 'login.html');
      }
    }
    return ALLOWED_ORIGIN + '/login.html'; // fallback
  }


  /* ─────────────────────────────────────────────
     2. SESSION HELPERS
  ───────────────────────────────────────────── */
  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function isValid(session) {
    if (!session || !session.email) return false;
    if (session.lastActive && Date.now() - session.lastActive > INACTIVITY_TTL) return false;
    return true;
  }

  function redirectToLogin() {
    sessionStorage.removeItem(SESSION_KEY);
    document.documentElement.style.visibility = 'hidden';
    const next = encodeURIComponent(window.location.href);
    window.location.replace(getLoginUrl() + '?next=' + next);
  }


  /* ─────────────────────────────────────────────
     3. IMMEDIATE SESSION GUARD
        Runs before the page renders — blocks access
        if there is no valid session.
  ───────────────────────────────────────────── */
  const session = getSession();
  if (!isValid(session)) {
    redirectToLogin();
    return; // stop the rest of the script
  }


  /* ─────────────────────────────────────────────
     4. INACTIVITY TIMER
        Resets on every user interaction.
        Redirects to login after 30 min of silence.
  ───────────────────────────────────────────── */
  let activityTimer;

  function resetActivity() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) { redirectToLogin(); return; }
      const s = JSON.parse(raw);
      s.lastActive = Date.now();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) {
      redirectToLogin();
      return;
    }
    clearTimeout(activityTimer);
    activityTimer = setTimeout(redirectToLogin, INACTIVITY_TTL);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    .forEach(evt => document.addEventListener(evt, resetActivity, { passive: true }));

  activityTimer = setTimeout(redirectToLogin, INACTIVITY_TTL);


  /* ─────────────────────────────────────────────
     5. SIGN OUT  (global: signOut())
  ───────────────────────────────────────────── */
  window.signOut = function () {
    clearTimeout(activityTimer);
    sessionStorage.removeItem(SESSION_KEY);
    try {
      if (window.google?.accounts?.id) {
        google.accounts.id.disableAutoSelect();
      }
    } catch (e) {}
    window.location.replace(getLoginUrl());
  };

  // Legacy alias
  window.logout = window.signOut;


  /* ─────────────────────────────────────────────
     6. GET USER  (global: getUser())
        Returns the parsed session object or {}.
        Usage: const user = getUser();
               console.log(user.name, user.role, user.email);
  ───────────────────────────────────────────── */
  window.getUser = function () {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    } catch (e) {
      return {};
    }
  };


  /* ─────────────────────────────────────────────
     7. HANDLE LOGIN REDIRECT  → defined below the IIFE
        so login.html can call it even without a session.
  ───────────────────────────────────────────── */


  /* ─────────────────────────────────────────────
     9. POPULATE USER CHIP
        Fills in #tb-avatar, #tb-uname, #tb-urole,
        and #tb-user-chip on every protected page
        that includes those elements.
  ───────────────────────────────────────────── */
  function populateUserChip() {
    try {
      const u = getUser();
      if (!u || !u.email) return;

      // Build initials: "Afan Haidar" → "AH"
      const nameParts = (u.name || u.email).trim().split(/\s+/);
      const initials  = nameParts.length >= 2
        ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
        : (u.name || u.email).substring(0, 2).toUpperCase();

      const fullName = u.name || u.email;
      const role     = u.role || 'User';

      const avatarEl = document.getElementById('tb-avatar');
      const nameEl   = document.getElementById('tb-uname');
      const roleEl   = document.getElementById('tb-urole');
      const chipEl   = document.getElementById('tb-user-chip');

      if (avatarEl) avatarEl.textContent = initials;
      if (nameEl)   nameEl.textContent   = fullName;
      if (roleEl)   roleEl.textContent   = role;

      if (chipEl) {
        chipEl.title   = 'Signed in as ' + u.email + '\nClick to sign out';
        chipEl.onclick = function () {
          if (confirm('Sign out ' + fullName + '?')) signOut();
        };
        chipEl.style.cursor = 'pointer';
      }
    } catch (e) {
      console.warn('/shared/auth.js populateUserChip:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateUserChip);
  } else {
    populateUserChip();
  }

})();


/* ═══════════════════════════════════════════════════════════════
   handleLoginRedirect()
   Defined OUTSIDE the IIFE so login.html can call it even when
   there is no active session (the IIFE returns early in that case).

   Call this immediately after saving the session on login success:
     sessionStorage.setItem('ap_user', JSON.stringify({ ... }));
     handleLoginRedirect();
═══════════════════════════════════════════════════════════════ */
window.handleLoginRedirect = function () {
  const ALLOWED_ORIGIN = 'https://effimalik.github.io/FleetManagement';
  const DEFAULT_PAGE   = ALLOWED_ORIGIN + '/index.html';
  try {
    const params = new URLSearchParams(window.location.search);
    const next   = decodeURIComponent(params.get('next') || '');
    // Only redirect within our own app — prevents open-redirect attacks
    if (next && next.startsWith(ALLOWED_ORIGIN)) {
      window.location.replace(next);
    } else {
      window.location.replace(DEFAULT_PAGE);
    }
  } catch (e) {
    window.location.replace(DEFAULT_PAGE);
  }
};

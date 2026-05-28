/* ══ AUTH GUARD — AdminPro UAE ══
   Place this as the FIRST script in <head> of every protected page:
   Root pages  → <script src="auth.js"></script>
   Reg/ pages  → <script src="../auth.js"></script>
================================================== */
(function () {
  'use strict';

  const SESSION_KEY    = 'adminpro_session';
  const LOGIN_PAGE     = '../login.html';
  const INACTIVITY_TTL = 30 * 60 * 1000; // 30 minutes

  /* ── Resolve login.html path regardless of subfolder depth ── */
  function getLoginUrl() {
    const depth = window.location.pathname.split('/').length - 2;
    const prefix = depth > 0 ? '../'.repeat(depth) : '';
    return prefix + LOGIN_PAGE;
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function isValid(session) {
    if (!session || !session.token || !session.lastActive) return false;
    if (Date.now() - session.lastActive > INACTIVITY_TTL) return false;
    return true;
  }

  function redirectToLogin() {
    sessionStorage.removeItem(SESSION_KEY);
    document.documentElement.style.visibility = 'hidden';
    const intended = encodeURIComponent(window.location.href);
    window.location.replace(getLoginUrl() + '?next=' + intended);
  }

  /* ── Block immediately on page load ── */
  const session = getSession();
  if (!isValid(session)) {
    redirectToLogin();
    return;
  }

  /* ── Inactivity timer ── */
  let activityTimer;

  function resetActivity() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) { redirectToLogin(); return; }
      const s = JSON.parse(raw);
      s.lastActive = Date.now();
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    } catch (e) { redirectToLogin(); }

    clearTimeout(activityTimer);
    activityTimer = setTimeout(redirectToLogin, INACTIVITY_TTL);
  }

  /* ── Listen to all user activity ── */
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    .forEach(evt => document.addEventListener(evt, resetActivity, { passive: true }));

  /* ── Start first countdown ── */
  activityTimer = setTimeout(redirectToLogin, INACTIVITY_TTL);

})();

function logout() {
  sessionStorage.removeItem('adminpro_session');
  if (window.google?.accounts?.id) {
    google.accounts.id.disableAutoSelect();
  }
  window.location.replace('login.html');
}

/* ═══════════════════════════════════════════════════════════════
   auth.js — AdminPro UAE (CLEAN FIXED VERSION)
═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const SESSION_KEY = 'ap_user';
  const INACTIVITY_TTL = 30 * 60 * 1000;
  const ALLOWED_ORIGIN = 'https://effimalik.github.io/FleetManagement/';
  const DEFAULT_PAGE = ALLOWED_ORIGIN + 'index.html';

  function getLoginUrl() {
    return ALLOWED_ORIGIN + 'login.html';
  }

  function getSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
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

  const session = getSession();
  if (!isValid(session)) {
    redirectToLogin();
  }

  let activityTimer;

  function resetActivity() {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return redirectToLogin();

    const s = JSON.parse(raw);
    s.lastActive = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));

    clearTimeout(activityTimer);
    activityTimer = setTimeout(redirectToLogin, INACTIVITY_TTL);
  }

  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click']
    .forEach(evt => document.addEventListener(evt, resetActivity, { passive: true }));

  activityTimer = setTimeout(redirectToLogin, INACTIVITY_TTL);

  window.signOut = function () {
    clearTimeout(activityTimer);
    sessionStorage.removeItem(SESSION_KEY);
    window.location.replace(getLoginUrl());
  };

  window.logout = window.signOut;

  window.getUser = function () {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}');
    } catch {
      return {};
    }
  };

  function populateUserChip() {
    const u = getUser();
    if (!u.email) return;

    const parts = (u.name || u.email).split(' ');
    const initials = parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : (u.name || u.email).substring(0, 2).toUpperCase();

    const avatar = document.getElementById('tb-avatar');
    const name = document.getElementById('tb-uname');
    const role = document.getElementById('tb-urole');
    const chip = document.getElementById('tb-user-chip');

    if (avatar) avatar.textContent = initials;
    if (name) name.textContent = u.name || u.email;
    if (role) role.textContent = u.role || 'User';

    if (chip) {
      chip.title = 'Signed in as ' + u.email;
      chip.onclick = () => signOut();
      chip.style.cursor = 'pointer';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', populateUserChip);
  } else {
    populateUserChip();
  }

})();

/* ═════════ LOGIN REDIRECT ═════════ */
window.handleLoginRedirect = function () {
  const ALLOWED_ORIGIN = 'https://effimalik.github.io/FleetManagement/';
  const DEFAULT_PAGE = ALLOWED_ORIGIN + 'index.html';

  try {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');

    if (next && next.startsWith(ALLOWED_ORIGIN)) {
      window.location.replace(next);
    } else {
      window.location.replace(DEFAULT_PAGE);
    }
  } catch {
    window.location.replace(DEFAULT_PAGE);
  }
};

/* ═════════ SECURITY BLOCKS ═════════ */
document.addEventListener('contextmenu', e => e.preventDefault());

document.addEventListener('keydown', function (e) {
  if (
    e.key === 'F12' ||
    (e.ctrlKey && e.shiftKey && ['I', 'J'].includes(e.key)) ||
    (e.ctrlKey && e.key === 'U')
  ) {
    e.preventDefault();
  }
});

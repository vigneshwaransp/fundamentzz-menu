const { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } = require('./config');
const { verifySessionToken, hasPermission } = require('./auth');

/**
 * Cookie parser helper
 */
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  const pairs = header.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx !== -1) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch (_) {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

/**
 * Helper to set HttpOnly, SameSite=Strict session cookie
 */
function setSessionCookie(req, res, token) {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isSecure,
    path: '/',
    maxAge: SESSION_MAX_AGE_MS
  });
}

/**
 * Helper to clear session cookie
 */
function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict'
  });
}

/**
 * Global security headers: nosniff, referrer-policy, X-Frame-Options DENY, noindex on admin
 */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.path.startsWith('/admin') || req.path.startsWith('/api/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }

  next();
}

/**
 * CSRF protection: all non-GET /api requests must carry the header X-Requested-With: dm
 */
function csrfProtection(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  if (!req.path.startsWith('/api')) {
    return next();
  }

  const header = req.headers['x-requested-with'];
  if (!header || header.toLowerCase() !== 'dm') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'CSRF header missing or invalid. Non-GET API requests must include "X-Requested-With: dm".'
    });
  }

  next();
}

/**
 * In-memory rate limiting for login: 8 failed attempts per IP per 10 minutes
 */
const loginFailuresByIp = new Map();

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const timestamps = loginFailuresByIp.get(ip) || [];
  const recent = timestamps.filter(t => now - t < windowMs);
  loginFailuresByIp.set(ip, recent);
  return recent.length >= 8;
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const timestamps = loginFailuresByIp.get(ip) || [];
  const recent = timestamps.filter(t => now - t < windowMs);
  recent.push(now);
  loginFailuresByIp.set(ip, recent);
}

function clearLoginFailures(ip) {
  loginFailuresByIp.delete(ip);
}

/**
 * RBAC permission check middleware: returns 401 when signed out and 403 when lacking permission
 */
function requirePerm(permission) {
  return async (req, res, next) => {
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Sign in required'
      });
    }

    const user = await verifySessionToken(token);
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired session'
      });
    }

    req.user = user;

    if (permission && !hasPermission(user, permission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: insufficient permissions'
      });
    }

    next();
  };
}

/**
 * Non-blocking session inspector (for public preview detection)
 */
async function attachUser(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    req.user = await verifySessionToken(token);
  } else {
    req.user = null;
  }
  next();
}

module.exports = {
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  securityHeaders,
  csrfProtection,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  requirePerm,
  attachUser,
};

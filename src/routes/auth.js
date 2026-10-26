const express = require('express');
const router = express.Router();
const { authenticateUser, createSessionToken, changePassword } = require('../auth');
const {
  setSessionCookie,
  clearSessionCookie,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
  requirePerm,
  parseCookies
} = require('../middleware');
const { verifySessionToken } = require('../auth');
const { SESSION_COOKIE_NAME } = require('../config');

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || '127.0.0.1';

  if (checkLoginRateLimit(ip)) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Too many failed login attempts. Please try again in 5 minutes.'
    });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    recordLoginFailure(ip);
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Email and password are required.'
    });
  }

  const user = await authenticateUser(email, password);
  if (!user) {
    recordLoginFailure(ip);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid email or password.'
    });
  }

  // Clear rate-limit history on successful login
  clearLoginFailures(ip);

  const token = await createSessionToken(user);
  setSessionCookie(req, res, token);

  res.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role
    }
  });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true, message: 'Logged out successfully.' });
});

/**
 * GET /api/auth/me
 */
router.get('/me', async (req, res) => {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Not logged in' });
  }

  const user = await verifySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Session invalid or expired' });
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions
    }
  });
});

/**
 * POST /api/auth/password
 */
router.post('/password', requirePerm('account:write'), async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Current password and new password are required.'
    });
  }

  const result = await changePassword(req.user.id, oldPassword, newPassword);
  if (!result.ok) {
    return res.status(400).json({
      error: 'Bad Request',
      message: result.error
    });
  }

  // Issue new session token with updated passwordVersion
  const newToken = await createSessionToken(result.user);
  setSessionCookie(req, res, newToken);

  res.json({
    ok: true,
    message: 'Password changed successfully. All other sessions have been invalidated.'
  });
});

module.exports = router;

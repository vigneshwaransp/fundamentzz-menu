const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { OWNER_EMAIL, OWNER_PASSWORD, SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } = require('./config');

const ROLE_PERMISSIONS = {
  owner: ['menus:read', 'menus:write', 'account:write']
};

// Pre-computed dummy hash for constant-time comparison on nonexistent accounts
const DUMMY_HASH = bcrypt.hashSync('dummy_password_timing_mitigation_salt_123', 10);

/**
 * Seed initial owner on first run if no users exist
 */
async function seedOwnerIfNeeded() {
  const users = await db.getUsers();
  if (users.length === 0) {
    let plainPassword = OWNER_PASSWORD;
    let generated = false;
    if (!plainPassword) {
      plainPassword = crypto.randomBytes(9).toString('base64url');
      generated = true;
    }

    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const ownerUser = {
      id: `usr_${crypto.randomBytes(8).toString('hex')}`,
      email: OWNER_EMAIL,
      passwordHash,
      role: 'owner',
      passwordVersion: 1,
      createdAt: new Date().toISOString()
    };

    await db.saveUsers([ownerUser]);

    console.log('----------------------------------------------------');
    console.log('[SEED] Initial owner account created.');
    console.log('----------------------------------------------------');
    return;
  }

  // Ensure owner account matches configured OWNER_EMAIL and OWNER_PASSWORD
  const owner = users.find(u => u.role === 'owner') || users[0];
  if (owner && OWNER_PASSWORD) {
    const isMatch = await bcrypt.compare(OWNER_PASSWORD, owner.passwordHash);
    if (!isMatch || owner.email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
      owner.email = OWNER_EMAIL;
      owner.passwordHash = await bcrypt.hash(OWNER_PASSWORD, 10);
      owner.passwordVersion = (owner.passwordVersion || 1) + 1;
      owner.updatedAt = new Date().toISOString();
      await db.saveUsers(users);
      console.log(`[SEED] Synchronized owner account to ${OWNER_EMAIL}`);
    }
  }
}

/**
 * Sign session token using HMAC-SHA256
 */
async function createSessionToken(user) {
  const secret = await db.getSecretKey();
  const payload = {
    uid: user.id,
    role: user.role,
    pver: user.passwordVersion || 1,
    exp: Date.now() + SESSION_MAX_AGE_MS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payloadB64);
  const signature = hmac.digest('base64url');
  return `${payloadB64}.${signature}`;
}

/**
 * Verify and decode session token
 */
async function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;

  try {
    const secret = await db.getSecretKey();
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payloadB64);
    const expectedSig = hmac.digest('base64url');

    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) {
      return null;
    }

    const user = await db.getUserById(payload.uid);
    if (!user) return null;

    // Check if password version matches (changing password increments version, invalidating old sessions)
    if ((user.passwordVersion || 1) !== payload.pver) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: ROLE_PERMISSIONS[user.role] || []
    };
  } catch (err) {
    return null;
  }
}

/**
 * Authenticate login credentials
 */
async function authenticateUser(email, password) {
  if (!email || !password || typeof password !== 'string') {
    await bcrypt.compare('dummy', DUMMY_HASH);
    return null;
  }

  const user = await db.getUserByEmail(email);
  if (!user) {
    // Run dummy compare to mitigate timing attacks on nonexistent accounts
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    return null;
  }

  return user;
}

/**
 * Change user password and invalidate previous sessions
 */
async function changePassword(userId, oldPassword, newPassword) {
  const user = await db.getUserById(userId);
  if (!user) {
    return { ok: false, error: 'User not found' };
  }

  const match = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!match) {
    return { ok: false, error: 'Incorrect current password' };
  }

  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return { ok: false, error: 'New password must be at least 8 characters long' };
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  const users = await db.getUsers();
  const idx = users.findIndex(u => u.id === userId);
  if (idx === -1) return { ok: false, error: 'User not found' };

  users[idx].passwordHash = newHash;
  users[idx].passwordVersion = (users[idx].passwordVersion || 1) + 1;
  users[idx].updatedAt = new Date().toISOString();

  await db.saveUsers(users);
  return { ok: true, user: users[idx] };
}

function hasPermission(user, permission) {
  if (!user || !user.permissions) return false;
  return user.permissions.includes(permission);
}

module.exports = {
  ROLE_PERMISSIONS,
  seedOwnerIfNeeded,
  createSessionToken,
  verifySessionToken,
  authenticateUser,
  changePassword,
  hasPermission,
};

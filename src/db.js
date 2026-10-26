const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');

const MENUS_DIR = path.join(DATA_DIR, 'menus');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

/**
 * Perform an atomic write to disk: write to a temporary file in the same directory, then rename.
 */
async function atomicWrite(targetPath, content) {
  const dir = path.dirname(targetPath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${crypto.randomBytes(6).toString('hex')}`;
  
  await fs.promises.writeFile(tmpPath, content);
  
  let attempts = 0;
  while (true) {
    try {
      await fs.promises.rename(tmpPath, targetPath);
      break;
    } catch (err) {
      attempts++;
      if (attempts >= 5) {
        // Clean up temp file on failure
        try { await fs.promises.unlink(tmpPath); } catch (_) {}
        throw err;
      }
      await new Promise(r => setTimeout(r, 20));
    }
  }
}

/**
 * Initialize base data directories
 */
async function initDataDir() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.mkdir(MENUS_DIR, { recursive: true });
}

/**
 * Get or generate HMAC secret key
 */
async function getSecretKey() {
  await initDataDir();
  try {
    const key = await fs.promises.readFile(SECRET_FILE, 'utf8');
    if (key && key.trim().length >= 32) {
      return key.trim();
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const newKey = crypto.randomBytes(64).toString('hex');
  await atomicWrite(SECRET_FILE, newKey);
  return newKey;
}

/**
 * User storage functions
 */
async function getUsers() {
  await initDataDir();
  try {
    const raw = await fs.promises.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveUsers(users) {
  const data = JSON.stringify({ users }, null, 2);
  await atomicWrite(USERS_FILE, data);
}

async function getUserByEmail(email) {
  if (!email) return null;
  const users = await getUsers();
  const normalized = email.trim().toLowerCase();
  return users.find(u => u.email.toLowerCase() === normalized) || null;
}

async function getUserById(id) {
  if (!id) return null;
  const users = await getUsers();
  return users.find(u => u.id === id) || null;
}

/**
 * Menu storage functions
 */
async function listMenus() {
  await initDataDir();
  try {
    const entries = await fs.promises.readdir(MENUS_DIR, { withFileTypes: true });
    const menus = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const menuPath = path.join(MENUS_DIR, ent.name, 'menu.json');
      try {
        const raw = await fs.promises.readFile(menuPath, 'utf8');
        const menu = JSON.parse(raw);
        menus.push(menu);
      } catch (_) {
        // Skip corrupted or incomplete directory
      }
    }
    // Sort by updatedAt descending
    menus.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    return menus;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function getMenuById(id) {
  if (!id || typeof id !== 'string') return null;
  const safeId = path.basename(id);
  const menuPath = path.join(MENUS_DIR, safeId, 'menu.json');
  try {
    const raw = await fs.promises.readFile(menuPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function getMenuBySlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const menus = await listMenus();
  return menus.find(m => m.slug === slug) || null;
}

async function saveMenu(menu) {
  if (!menu || !menu.id) throw new Error('Menu must have an id');
  const safeId = path.basename(menu.id);
  const menuDir = path.join(MENUS_DIR, safeId);
  await fs.promises.mkdir(menuDir, { recursive: true });
  const menuPath = path.join(menuDir, 'menu.json');
  const content = JSON.stringify(menu, null, 2);
  await atomicWrite(menuPath, content);
}

async function deleteMenu(id) {
  if (!id || typeof id !== 'string') return false;
  const safeId = path.basename(id);
  const menuDir = path.join(MENUS_DIR, safeId);
  try {
    await fs.promises.rm(menuDir, { recursive: true, force: true });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = {
  MENUS_DIR,
  atomicWrite,
  initDataDir,
  getSecretKey,
  getUsers,
  saveUsers,
  getUserByEmail,
  getUserById,
  listMenus,
  getMenuById,
  getMenuBySlug,
  saveMenu,
  deleteMenu,
};

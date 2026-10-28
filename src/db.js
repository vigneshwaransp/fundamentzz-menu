const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./config');
const cloudStorage = require('./cloud-storage');

const MENUS_DIR = path.join(DATA_DIR, 'menus');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const SEED_FILE = path.join(__dirname, 'seed', 'menus_seed.json');

// High-speed In-Memory Cache (survives warm invocations)
const menusCache = new Map();
let isInitialized = false;

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
        try { await fs.promises.unlink(tmpPath); } catch (_) {}
        throw err;
      }
      await new Promise(r => setTimeout(r, 20));
    }
  }
}

/**
 * Load bundled seed menus if available
 */
function loadSeedMenus() {
  try {
    if (fs.existsSync(SEED_FILE)) {
      const raw = fs.readFileSync(SEED_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (err) {
    console.warn('[SEED LOAD WARNING]', err.message);
  }
  return [];
}

/**
 * Initialize base data directories and hydrate multi-tier storage
 */
async function initDataDir() {
  if (isInitialized && menusCache.size > 0) return;

  await fs.promises.mkdir(DATA_DIR, { recursive: true });
  await fs.promises.mkdir(MENUS_DIR, { recursive: true });

  // 1. If Cloud KV is configured, attempt to load persistent menus from Cloud KV
  if (cloudStorage.hasKV) {
    try {
      const kvMenus = await cloudStorage.kvListMenus();
      if (Array.isArray(kvMenus) && kvMenus.length > 0) {
        for (const m of kvMenus) {
          menusCache.set(m.id, m);
          // Mirror to local disk cache in background
          saveMenuToDiskOnly(m).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[KV INIT WARNING]', err.message);
    }
  }

  // 2. If memory cache still empty, load existing menus from local disk
  if (menusCache.size === 0) {
    try {
      const entries = await fs.promises.readdir(MENUS_DIR, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const menuPath = path.join(MENUS_DIR, ent.name, 'menu.json');
        try {
          const raw = await fs.promises.readFile(menuPath, 'utf8');
          const menu = JSON.parse(raw);
          if (menu && menu.id) {
            menusCache.set(menu.id, menu);
            if (cloudStorage.hasKV) {
              cloudStorage.kvSaveMenu(menu).catch(() => {});
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 3. If still empty (e.g. fresh container cold start on Vercel), hydrate from bundled seed snapshot
  if (menusCache.size === 0) {
    const seedMenus = loadSeedMenus();
    for (const m of seedMenus) {
      if (m && m.id) {
        menusCache.set(m.id, m);
        saveMenuToDiskOnly(m).catch(() => {});
        if (cloudStorage.hasKV) {
          cloudStorage.kvSaveMenu(m).catch(() => {});
        }
      }
    }
  }

  isInitialized = true;
}

/**
 * Helper to write a menu to local disk without touching cloud KV
 */
async function saveMenuToDiskOnly(menu) {
  if (!menu || !menu.id) return;
  const safeId = path.basename(menu.id);
  const menuDir = path.join(MENUS_DIR, safeId);
  await fs.promises.mkdir(menuDir, { recursive: true });
  const menuPath = path.join(menuDir, 'menu.json');
  await atomicWrite(menuPath, JSON.stringify(menu, null, 2));
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
 * User storage functions (with Cloud KV synchronization)
 */
async function getUsers() {
  await initDataDir();

  // Try Cloud KV first
  if (cloudStorage.hasKV) {
    try {
      const kvUsers = await cloudStorage.kvGetUsers();
      if (Array.isArray(kvUsers) && kvUsers.length > 0) {
        // Keep disk in sync
        atomicWrite(USERS_FILE, JSON.stringify({ users: kvUsers }, null, 2)).catch(() => {});
        return kvUsers;
      }
    } catch (_) {}
  }

  // Fallback to disk
  try {
    const raw = await fs.promises.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    if (users.length > 0 && cloudStorage.hasKV) {
      cloudStorage.kvSaveUsers(users).catch(() => {});
    }
    return users;
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveUsers(users) {
  const data = JSON.stringify({ users }, null, 2);
  await atomicWrite(USERS_FILE, data);

  // Sync with Cloud KV
  if (cloudStorage.hasKV) {
    try {
      await cloudStorage.kvSaveUsers(users);
    } catch (_) {}
  }
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

  // If memory cache is empty, try re-syncing from Cloud KV or disk
  if (menusCache.size === 0) {
    if (cloudStorage.hasKV) {
      const kvMenus = await cloudStorage.kvListMenus();
      if (Array.isArray(kvMenus) && kvMenus.length > 0) {
        for (const m of kvMenus) menusCache.set(m.id, m);
      }
    }
    if (menusCache.size === 0) {
      const seedMenus = loadSeedMenus();
      for (const m of seedMenus) menusCache.set(m.id, m);
    }
  }

  const menus = Array.from(menusCache.values());
  menus.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return menus;
}

async function getMenuById(id) {
  if (!id || typeof id !== 'string') return null;
  await initDataDir();

  if (menusCache.has(id)) {
    return menusCache.get(id);
  }

  if (cloudStorage.hasKV) {
    const m = await cloudStorage.kvGetMenu(id);
    if (m) {
      menusCache.set(m.id, m);
      return m;
    }
  }

  const safeId = path.basename(id);
  const menuPath = path.join(MENUS_DIR, safeId, 'menu.json');
  try {
    const raw = await fs.promises.readFile(menuPath, 'utf8');
    const menu = JSON.parse(raw);
    if (menu?.id) {
      menusCache.set(menu.id, menu);
      return menu;
    }
  } catch (_) {}

  return null;
}

async function getMenuBySlug(slug) {
  if (!slug || typeof slug !== 'string') return null;
  const menus = await listMenus();
  return menus.find(m => m.slug === slug) || null;
}

async function saveMenu(menu) {
  if (!menu || !menu.id) throw new Error('Menu must have an id');
  await initDataDir();

  // 1. Update in-memory cache immediately
  menusCache.set(menu.id, menu);

  // 2. Save to local disk atomically
  await saveMenuToDiskOnly(menu);

  // 3. Save to Cloud KV (Upstash / Vercel KV) if available
  if (cloudStorage.hasKV) {
    try {
      await cloudStorage.kvSaveMenu(menu);
    } catch (err) {
      console.warn('[KV SAVE WARNING]', err.message);
    }
  }
}

async function deleteMenu(id) {
  if (!id || typeof id !== 'string') return false;
  await initDataDir();

  // 1. Remove from in-memory cache
  menusCache.delete(id);

  // 2. Remove from local disk
  const safeId = path.basename(id);
  const menuDir = path.join(MENUS_DIR, safeId);
  try {
    await fs.promises.rm(menuDir, { recursive: true, force: true });
  } catch (_) {}

  // 3. Remove from Cloud KV
  if (cloudStorage.hasKV) {
    try {
      await cloudStorage.kvDeleteMenu(id);
    } catch (_) {}
  }

  return true;
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
  getStorageStatus: () => cloudStorage.getStorageStatus(menusCache.size)
};

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR, SESSION_SECRET } = require('./config');
const cloudStorage = require('./cloud-storage');
const mongodb = require('./mongodb');

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

  // 1. Try MongoDB Atlas Cloud first
  try {
    const mongoMenus = await mongodb.mongoListMenus();
    if (Array.isArray(mongoMenus) && mongoMenus.length > 0) {
      for (const m of mongoMenus) {
        menusCache.set(m.id, m);
        saveMenuToDiskOnly(m).catch(() => {});
      }
    } else if (Array.isArray(mongoMenus) && mongoMenus.length === 0) {
      // MongoDB connected but empty: seed initial snapshot into MongoDB
      const seedMenus = loadSeedMenus();
      for (const m of seedMenus) {
        if (m && m.id) {
          menusCache.set(m.id, m);
          mongodb.mongoSaveMenu(m).catch(() => {});
          saveMenuToDiskOnly(m).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('[MONGO INIT WARNING]', err.message);
  }

  // 2. If Cloud KV is configured and cache still empty, attempt to load from Cloud KV
  if (menusCache.size === 0 && cloudStorage.hasKV) {
    try {
      const kvMenus = await cloudStorage.kvListMenus();
      if (Array.isArray(kvMenus) && kvMenus.length > 0) {
        for (const m of kvMenus) {
          menusCache.set(m.id, m);
          saveMenuToDiskOnly(m).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('[KV INIT WARNING]', err.message);
    }
  }

  // 3. If memory cache still empty, load existing menus from local disk
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
            mongodb.mongoSaveMenu(menu).catch(() => {});
            if (cloudStorage.hasKV) {
              cloudStorage.kvSaveMenu(menu).catch(() => {});
            }
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 4. If still empty (fresh container cold start), hydrate from bundled seed snapshot
  if (menusCache.size === 0) {
    const seedMenus = loadSeedMenus();
    for (const m of seedMenus) {
      if (m && m.id) {
        menusCache.set(m.id, m);
        saveMenuToDiskOnly(m).catch(() => {});
        mongodb.mongoSaveMenu(m).catch(() => {});
        if (cloudStorage.hasKV) {
          cloudStorage.kvSaveMenu(m).catch(() => {});
        }
      }
    }
  }

  isInitialized = true;
}

/**
 * Helper to write a menu to local disk without touching cloud storage
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
 * Get or generate HMAC secret key (100% stable across serverless instances)
 */
async function getSecretKey() {
  // 1. Stable SESSION_SECRET from environment or configuration
  if (SESSION_SECRET && SESSION_SECRET.length >= 32) {
    return SESSION_SECRET;
  }

  // 2. Check MongoDB persistent system metadata
  try {
    const mongoKey = await mongodb.mongoGetSecretKey();
    if (mongoKey && mongoKey.trim().length >= 32) {
      return mongoKey.trim();
    }
  } catch (_) {}

  await initDataDir();

  // 3. Check local file
  try {
    const key = await fs.promises.readFile(SECRET_FILE, 'utf8');
    if (key && key.trim().length >= 32) {
      return key.trim();
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // 4. Fallback: generate and persist key
  const newKey = crypto.randomBytes(64).toString('hex');
  await atomicWrite(SECRET_FILE, newKey);
  mongodb.mongoSaveSecretKey(newKey).catch(() => {});
  return newKey;
}

/**
 * User storage functions (MongoDB -> Cloud KV -> Local Disk)
 */
async function getUsers() {
  await initDataDir();

  // 1. Try MongoDB Atlas first
  try {
    const mongoUsers = await mongodb.mongoGetUsers();
    if (Array.isArray(mongoUsers) && mongoUsers.length > 0) {
      // Keep disk in sync
      atomicWrite(USERS_FILE, JSON.stringify({ users: mongoUsers }, null, 2)).catch(() => {});
      return mongoUsers;
    }
  } catch (_) {}

  // 2. Try Cloud KV
  if (cloudStorage.hasKV) {
    try {
      const kvUsers = await cloudStorage.kvGetUsers();
      if (Array.isArray(kvUsers) && kvUsers.length > 0) {
        atomicWrite(USERS_FILE, JSON.stringify({ users: kvUsers }, null, 2)).catch(() => {});
        return kvUsers;
      }
    } catch (_) {}
  }

  // 3. Fallback to disk
  try {
    const raw = await fs.promises.readFile(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const users = Array.isArray(parsed.users) ? parsed.users : [];
    if (users.length > 0) {
      mongodb.mongoSaveUsers(users).catch(() => {});
      if (cloudStorage.hasKV) cloudStorage.kvSaveUsers(users).catch(() => {});
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

  // Sync with MongoDB Atlas
  mongodb.mongoSaveUsers(users).catch(() => {});

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

  // If memory cache is empty, try re-syncing from MongoDB, Cloud KV, or disk
  if (menusCache.size === 0) {
    try {
      const mongoMenus = await mongodb.mongoListMenus();
      if (Array.isArray(mongoMenus) && mongoMenus.length > 0) {
        for (const m of mongoMenus) menusCache.set(m.id, m);
      }
    } catch (_) {}

    if (menusCache.size === 0 && cloudStorage.hasKV) {
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

  // Try MongoDB
  try {
    const mongoMenu = await mongodb.mongoGetMenuById(id);
    if (mongoMenu) {
      menusCache.set(mongoMenu.id, mongoMenu);
      return mongoMenu;
    }
  } catch (_) {}

  // Try Cloud KV
  if (cloudStorage.hasKV) {
    const m = await cloudStorage.kvGetMenu(id);
    if (m) {
      menusCache.set(m.id, m);
      return m;
    }
  }

  // Try Local Disk
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

  // 3. Save to MongoDB Atlas
  mongodb.mongoSaveMenu(menu).catch(err => {
    console.warn('[MONGO SAVE MENU WARNING]', err.message);
  });

  // 4. Save to Cloud KV (Upstash / Vercel KV) if available
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

  // 3. Remove from MongoDB Atlas
  mongodb.mongoDeleteMenu(id).catch(err => {
    console.warn('[MONGO DELETE MENU WARNING]', err.message);
  });

  // 4. Remove from Cloud KV
  if (cloudStorage.hasKV) {
    try {
      await cloudStorage.kvDeleteMenu(id);
    } catch (_) {}
  }

  return true;
}

/**
 * Composite Storage Status including MongoDB Atlas & Cloud KV
 */
async function getStorageStatus() {
  const kvStatus = cloudStorage.getStorageStatus(menusCache.size);
  const mongoStatus = await mongodb.getMongoStatus();

  let provider = kvStatus.provider;
  let displayName = kvStatus.displayName;
  let isCloudPersistent = kvStatus.isCloudPersistent;

  if (mongoStatus.isConnected) {
    provider = 'mongodb-atlas';
    displayName = 'MongoDB Atlas Cloud (ReplicaSet)';
    isCloudPersistent = true;
  } else if (mongoStatus.isConfigured && mongoStatus.needsUsername) {
    displayName = 'MongoDB Atlas (Awaiting Username)';
  }

  return {
    provider,
    displayName,
    isCloudPersistent,
    localMenuCount: menusCache.size,
    mongo: mongoStatus,
    kv: {
      hasKV: kvStatus.hasKV,
      hasGitHub: kvStatus.hasGitHub
    },
    setupGuide: !isCloudPersistent ? {
      title: 'MongoDB Atlas & Cloud Storage Connection',
      steps: [
        mongoStatus.needsUsername
          ? `MongoDB Atlas cluster is configured! Please provide your MongoDB Atlas Database Username to complete connection.`
          : `Connect MongoDB Atlas using MONGODB_URI in your environment or Admin Storage Center.`
      ]
    } : null
  };
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
  getStorageStatus
};

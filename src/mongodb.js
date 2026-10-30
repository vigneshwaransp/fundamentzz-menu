/**
 * MongoDB Atlas Client Module for Fundamentzz Digital Menu
 * 
 * Provides:
 * - High-speed connection pooling optimized for serverless & long-lived Node.js runtimes
 * - Automatic resolution of Atlas replica sets with SSL
 * - Collections: menus, users, system_meta
 * - Graceful fallback so the site remains operational even if network is offline
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const {
  MONGODB_URI,
  MONGODB_USER,
  MONGODB_DB_NAME,
  DATA_DIR
} = require('./config');

const MONGO_CONFIG_FILE = path.join(DATA_DIR, 'mongodb.json');

// Global caching for serverless environments (prevents connection leaks across lambda invocations)
let cachedClient = null;
let cachedDb = null;
let connectionAttempted = false;
let lastConnectionError = null;

/**
 * Read custom saved username/uri from local config if present
 */
function getSavedMongoConfig() {
  try {
    if (fs.existsSync(MONGO_CONFIG_FILE)) {
      const raw = fs.readFileSync(MONGO_CONFIG_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return {};
}

/**
 * Save custom username/uri to config file
 */
function saveMongoConfig(config) {
  try {
    fs.mkdirSync(path.dirname(MONGO_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(MONGO_CONFIG_FILE, JSON.stringify(config, null, 2));
    // Reset cached client to force reconnect with new config
    cachedClient = null;
    cachedDb = null;
    connectionAttempted = false;
    return true;
  } catch (err) {
    console.warn('[MONGO CONFIG SAVE WARNING]', err.message);
    return false;
  }
}

/**
 * Resolve the final connection string
 */
function getResolvedMongoUri() {
  const saved = getSavedMongoConfig();
  let baseUri = saved.uri || MONGODB_URI || '';
  const user = saved.username || MONGODB_USER || process.env.DB_USERNAME || '';

  // Handle literal angle brackets or placeholder if the user pasted <username>
  if (baseUri.includes('<') && baseUri.includes('>')) {
    if (baseUri.includes('<db_username>') || baseUri.includes('<username>')) {
      if (user && user.trim()) {
        baseUri = baseUri.replace(/<db_username>|<username>/g, encodeURIComponent(user.trim()));
      } else {
        return { uri: baseUri, needsUsername: true, username: '' };
      }
    } else {
      // User entered e.g. <vigneshwaranspcs24_db_user>
      baseUri = baseUri.replace(/<([^>]+)>/g, '$1');
    }
  }

  // Ensure database name is set in URI path if missing
  if (baseUri && !baseUri.includes(`/${MONGODB_DB_NAME}`) && baseUri.includes('.net/')) {
    baseUri = baseUri.replace('.net/', `.net/${MONGODB_DB_NAME}`);
  }

  return { uri: baseUri, needsUsername: false, username: user };
}

/**
 * Get or initialize connected MongoDB Database instance
 */
async function getDb() {
  const { uri, needsUsername } = getResolvedMongoUri();

  if (needsUsername || !uri) {
    return null;
  }

  if (cachedDb && cachedClient) {
    return cachedDb;
  }

  try {
    connectionAttempted = true;
    lastConnectionError = null;

    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000,
      socketTimeoutMS: 15000,
      retryWrites: true
    });

    await client.connect();
    cachedClient = client;
    cachedDb = client.db(MONGODB_DB_NAME);

    // Initialize indexes in the background
    initIndexes(cachedDb).catch(err => console.warn('[MONGO INDEX WARNING]', err.message));

    console.log(`[MONGODB] Connected successfully to cluster database: "${MONGODB_DB_NAME}"`);
    return cachedDb;
  } catch (err) {
    lastConnectionError = err.message;
    console.warn(`[MONGODB CONNECTION FAILED] ${err.message}`);
    cachedClient = null;
    cachedDb = null;
    return null;
  }
}

/**
 * Initialize indexes for high performance querying
 */
async function initIndexes(db) {
  try {
    const menus = db.collection('menus');
    await menus.createIndex({ id: 1 }, { unique: true });
    await menus.createIndex({ slug: 1 }, { unique: true });
    await menus.createIndex({ updatedAt: -1 });

    const users = db.collection('users');
    await users.createIndex({ id: 1 }, { unique: true });
    await users.createIndex({ email: 1 }, { unique: true });

    const meta = db.collection('system_meta');
    await meta.createIndex({ key: 1 }, { unique: true });
  } catch (err) {
    console.warn('[MONGO INDEX CREATION]', err.message);
  }
}

/**
 * Check if MongoDB is connected and operational
 */
async function isMongoConnected() {
  const db = await getDb();
  if (!db) return false;
  try {
    await db.command({ ping: 1 });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Test a MongoDB connection string or username
 */
async function testMongoConnection(testUri, testUsername) {
  let uri = testUri || MONGODB_URI || '';
  if (testUsername && testUsername.trim()) {
    if (uri.includes('<db_username>') || uri.includes('<username>')) {
      uri = uri.replace(/<db_username>|<username>/g, encodeURIComponent(testUsername.trim()));
    } else {
      uri = uri.replace(/:\/\/([^:]+):/, `://${encodeURIComponent(testUsername.trim())}:`);
    }
  } else if (uri.includes('<db_username>') || uri.includes('<username>')) {
    return { ok: false, error: 'Database username is required.' };
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 5000
  });

  try {
    await client.connect();
    const adminDb = client.db().admin();
    const dbs = await adminDb.listDatabases();
    await client.close();
    return {
      ok: true,
      databases: dbs.databases.map(d => d.name),
      message: 'Successfully connected to MongoDB Atlas cluster!'
    };
  } catch (err) {
    await client.close().catch(() => {});
    return {
      ok: false,
      error: err.message
    };
  }
}

/**
 * Get MongoDB Status details for admin panel
 */
async function getMongoStatus() {
  const { uri, needsUsername, username } = getResolvedMongoUri();
  const connected = await isMongoConnected();

  // Obfuscate password in URI for UI display
  const maskedUri = uri ? uri.replace(/:([^@]+)@/, ':••••••••@') : '';

  const hostMatch = uri.match(/@([^/?]+)/);
  const clusterHost = hostMatch ? hostMatch[1] : 'cluster0.3sigkya.mongodb.net';

  return {
    isConfigured: Boolean(uri),
    isConnected: connected,
    needsUsername,
    username: username || '',
    maskedUri,
    databaseName: MONGODB_DB_NAME,
    lastError: lastConnectionError,
    clusterHost
  };
}

/* ==========================================================================
   CRUD Operations on MongoDB Collections
   ========================================================================== */

// --- Menus ---
async function mongoListMenus() {
  const db = await getDb();
  if (!db) return null;
  try {
    const list = await db.collection('menus')
      .find({})
      .sort({ updatedAt: -1 })
      .toArray();
    return list.map(doc => {
      const { _id, ...clean } = doc;
      return clean;
    });
  } catch (err) {
    console.warn('[MONGO LIST MENUS ERROR]', err.message);
    return null;
  }
}

async function mongoGetMenuById(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const doc = await db.collection('menus').findOne({ id });
    if (!doc) return null;
    const { _id, ...clean } = doc;
    return clean;
  } catch (err) {
    console.warn('[MONGO GET MENU ERROR]', err.message);
    return null;
  }
}

async function mongoGetMenuBySlug(slug) {
  if (!slug) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const doc = await db.collection('menus').findOne({ slug });
    if (!doc) return null;
    const { _id, ...clean } = doc;
    return clean;
  } catch (err) {
    console.warn('[MONGO GET MENU BY SLUG ERROR]', err.message);
    return null;
  }
}

async function mongoSaveMenu(menu) {
  if (!menu || !menu.id) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    await db.collection('menus').updateOne(
      { id: menu.id },
      { $set: menu },
      { upsert: true }
    );
    return true;
  } catch (err) {
    console.warn('[MONGO SAVE MENU ERROR]', err.message);
    return false;
  }
}

async function mongoDeleteMenu(id) {
  if (!id) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const res = await db.collection('menus').deleteOne({ id });
    return res.deletedCount > 0;
  } catch (err) {
    console.warn('[MONGO DELETE MENU ERROR]', err.message);
    return false;
  }
}

// --- Users ---
async function mongoGetUsers() {
  const db = await getDb();
  if (!db) return null;
  try {
    const users = await db.collection('users').find({}).toArray();
    return users.map(u => {
      const { _id, ...clean } = u;
      return clean;
    });
  } catch (err) {
    console.warn('[MONGO GET USERS ERROR]', err.message);
    return null;
  }
}

async function mongoSaveUsers(users) {
  if (!Array.isArray(users)) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    const collection = db.collection('users');
    for (const u of users) {
      if (!u.id) continue;
      await collection.updateOne(
        { id: u.id },
        { $set: u },
        { upsert: true }
      );
    }
    return true;
  } catch (err) {
    console.warn('[MONGO SAVE USERS ERROR]', err.message);
    return false;
  }
}

async function mongoGetUserById(id) {
  if (!id) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const doc = await db.collection('users').findOne({ id });
    if (!doc) return null;
    const { _id, ...clean } = doc;
    return clean;
  } catch (err) {
    return null;
  }
}

async function mongoGetUserByEmail(email) {
  if (!email) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const normalized = email.trim().toLowerCase();
    const doc = await db.collection('users').findOne({
      email: { $regex: new RegExp(`^${normalized}$`, 'i') }
    });
    if (!doc) return null;
    const { _id, ...clean } = doc;
    return clean;
  } catch (err) {
    return null;
  }
}

// --- System Meta (Persistent Session Secret) ---
async function mongoGetSecretKey() {
  const db = await getDb();
  if (!db) return null;
  try {
    const doc = await db.collection('system_meta').findOne({ key: 'session_secret' });
    return doc?.value || null;
  } catch (err) {
    return null;
  }
}

async function mongoSaveSecretKey(secret) {
  if (!secret) return false;
  const db = await getDb();
  if (!db) return false;
  try {
    await db.collection('system_meta').updateOne(
      { key: 'session_secret' },
      { $set: { key: 'session_secret', value: secret, updatedAt: new Date().toISOString() } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getDb,
  isMongoConnected,
  getResolvedMongoUri,
  saveMongoConfig,
  testMongoConnection,
  getMongoStatus,
  mongoListMenus,
  mongoGetMenuById,
  mongoGetMenuBySlug,
  mongoSaveMenu,
  mongoDeleteMenu,
  mongoGetUsers,
  mongoSaveUsers,
  mongoGetUserById,
  mongoGetUserByEmail,
  mongoGetSecretKey,
  mongoSaveSecretKey
};

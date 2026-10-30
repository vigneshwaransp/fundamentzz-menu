const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const isVercel = !!process.env.VERCEL;
const defaultDataDir = isVercel ? '/tmp/data' : path.join(__dirname, '..', 'data');
const DATA_DIR = process.env.DATA_DIR || defaultDataDir;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'kavin@fundamentzz.com').trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'kavin@123';

// MongoDB Atlas Configuration
// User provided URI template with replicaSet and SSL:
const DEFAULT_MONGODB_URI = 'mongodb://<db_username>:eWxiekGUsqT9Q9Hl@ac-blagpff-shard-00-00.3sigkya.mongodb.net:27017,ac-blagpff-shard-00-01.3sigkya.mongodb.net:27017,ac-blagpff-shard-00-02.3sigkya.mongodb.net:27017/fundamentzz?ssl=true&replicaSet=atlas-yi2cxy-shard-0&authSource=admin';
const MONGODB_URI = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
const MONGODB_USER = process.env.MONGODB_USER || process.env.DB_USERNAME || '';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'fundamentzz';

// Stable Session Secret (guarantees sessions never expire across serverless container restarts)
const SESSION_SECRET = process.env.SESSION_SECRET || 'fundamentzz_auth_hmac_secret_2026_super_secure_vault_key_kavin_f9d8e7c6';
const SESSION_COOKIE_NAME = 'dm_session';
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

module.exports = {
  PORT,
  DATA_DIR,
  PUBLIC_URL,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  MONGODB_URI,
  MONGODB_USER,
  MONGODB_DB_NAME,
  SESSION_SECRET,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_MS,
};

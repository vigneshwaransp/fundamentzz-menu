const path = require('path');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'owner@fundamentzz.local').trim().toLowerCase();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || null;

module.exports = {
  PORT,
  DATA_DIR,
  PUBLIC_URL,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  SESSION_COOKIE_NAME: 'dm_session',
  SESSION_MAX_AGE_MS: 7 * 24 * 60 * 60 * 1000, // 7 days
};

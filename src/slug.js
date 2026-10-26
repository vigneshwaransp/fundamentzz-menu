const crypto = require('crypto');

const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/**
 * Generate a cryptographically secure random string of specified length
 */
function randomString(length = 6) {
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
}

/**
 * Convert name to safe latin slug prefix
 */
function slugifyName(name) {
  if (!name || typeof name !== 'string') return 'menu';
  
  // Normalize and replace common accented characters
  let clean = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!clean || clean.length === 0) {
    clean = 'menu';
  } else if (clean.length > 32) {
    clean = clean.slice(0, 32).replace(/-+$/, '');
  }

  return clean;
}

/**
 * Generate a unique, unguessable slug: <latin-name>-<6 random chars>
 */
function generateSlug(name) {
  const prefix = slugifyName(name);
  const rand = randomString(6);
  return `${prefix}-${rand}`;
}

module.exports = {
  slugifyName,
  randomString,
  generateSlug,
};

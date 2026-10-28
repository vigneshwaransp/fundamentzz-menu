/**
 * Universal Serverless Cloud Storage Client
 * Supports:
 * 1) Upstash Redis / Vercel KV via REST API (Zero extra dependencies, pure fetch)
 * 2) GitHub Repository Auto-Sync (Git-as-a-DB)
 * 3) Graceful in-memory fallback
 */

const { PUBLIC_URL } = require('./config');

const KV_URL = (
  process.env.KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.REDIS_REST_URL ||
  ''
).replace(/\/+$/, '');

const KV_TOKEN = (
  process.env.KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.REDIS_REST_TOKEN ||
  ''
);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'vigneshwaransp/fundamentzz-menu';

const hasKV = Boolean(KV_URL && KV_TOKEN);
const hasGitHub = Boolean(GITHUB_TOKEN && GITHUB_REPO);

/**
 * Send a Redis command to Upstash / Vercel KV via REST API
 * e.g. runKvCommand(['SET', 'key', 'val'])
 */
async function runKvCommand(commandArray) {
  if (!hasKV) return null;

  try {
    const res = await fetch(`${KV_URL}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commandArray)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[KV ERROR ${res.status}]`, errText);
      return null;
    }

    const data = await res.json();
    return data.result;
  } catch (err) {
    console.warn('[KV NETWORK WARNING]', err.message);
    return null;
  }
}

/**
 * Execute multiple Redis commands in a pipeline via REST API
 */
async function runKvPipeline(commandsArray) {
  if (!hasKV || !commandsArray.length) return null;

  try {
    const res = await fetch(`${KV_URL}/pipeline`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commandsArray)
    });

    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data.map(d => d.result) : null;
  } catch (err) {
    console.warn('[KV PIPELINE WARNING]', err.message);
    return null;
  }
}

/**
 * KV Menu Operations
 */
async function kvGetMenu(id) {
  if (!hasKV || !id) return null;
  const raw = await runKvCommand(['GET', `dm:menu:${id}`]);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (_) {
    return null;
  }
}

async function kvSaveMenu(menu) {
  if (!hasKV || !menu?.id) return false;
  const jsonStr = JSON.stringify(menu);
  const commands = [
    ['SET', `dm:menu:${menu.id}`, jsonStr],
    ['SADD', 'dm:menus_index', menu.id]
  ];
  if (menu.slug) {
    commands.push(['SET', `dm:slug:${menu.slug}`, menu.id]);
  }
  const results = await runKvPipeline(commands);
  return Boolean(results);
}

async function kvDeleteMenu(id) {
  if (!hasKV || !id) return false;
  const menu = await kvGetMenu(id);
  const commands = [
    ['DEL', `dm:menu:${id}`],
    ['SREM', 'dm:menus_index', id]
  ];
  if (menu?.slug) {
    commands.push(['DEL', `dm:slug:${menu.slug}`]);
  }
  await runKvPipeline(commands);
  return true;
}

async function kvListMenus() {
  if (!hasKV) return null;
  const ids = await runKvCommand(['SMEMBERS', 'dm:menus_index']);
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const pipeline = ids.map(id => ['GET', `dm:menu:${id}`]);
  const results = await runKvPipeline(pipeline);
  if (!results) return [];

  const menus = [];
  for (const raw of results) {
    if (!raw) continue;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && parsed.id) menus.push(parsed);
    } catch (_) {}
  }

  // Sort descending by updatedAt
  menus.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  return menus;
}

async function kvGetUsers() {
  if (!hasKV) return null;
  const raw = await runKvCommand(['GET', 'dm:users']);
  if (!raw) return null;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return null;
  }
}

async function kvSaveUsers(users) {
  if (!hasKV || !Array.isArray(users)) return false;
  await runKvCommand(['SET', 'dm:users', JSON.stringify(users)]);
  return true;
}

/**
 * Storage Health & Status Information
 */
function getStorageStatus(localMenuCount = 0) {
  let provider = 'serverless-local';
  let displayName = 'Multi-Tier Local Vault';
  let isCloudPersistent = false;

  if (hasKV) {
    provider = KV_URL.includes('upstash.io') ? 'upstash-redis' : 'vercel-kv';
    displayName = provider === 'upstash-redis' ? 'Upstash Redis Cloud' : 'Vercel KV Cloud';
    isCloudPersistent = true;
  } else if (hasGitHub) {
    provider = 'github-sync';
    displayName = 'GitHub Auto-Sync Engine';
    isCloudPersistent = true;
  }

  return {
    provider,
    displayName,
    isCloudPersistent,
    hasKV,
    hasGitHub,
    localMenuCount,
    setupGuide: !isCloudPersistent ? {
      title: 'Enable Permanent Global Cloud Storage (Free & Instant)',
      steps: [
        'Option 1 (Recommended for Vercel): In your Vercel Dashboard, go to Storage -> Create "KV" (Powered by Upstash). Vercel will automatically connect KV_REST_API_URL and KV_REST_API_TOKEN.',
        'Option 2 (Upstash Direct): Create a free Redis database at https://upstash.com and add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your Vercel Environment Variables.',
        'Option 3 (GitHub Auto-Sync): Add GITHUB_TOKEN in your Vercel Environment Variables to automatically commit all menus directly to your GitHub repository.'
      ]
    } : null
  };
}

module.exports = {
  hasKV,
  hasGitHub,
  runKvCommand,
  runKvPipeline,
  kvGetMenu,
  kvSaveMenu,
  kvDeleteMenu,
  kvListMenus,
  kvGetUsers,
  kvSaveUsers,
  getStorageStatus
};

const express = require('express');
const router = express.Router();
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const db = require('../db');
const { requirePerm } = require('../middleware');
const { parseUploadedMenuFile, sanitizeString, parsePrice, parseAvailable } = require('../parser');
const { processBatchImages, deleteOldImageVersion } = require('../images');
const { generateSlug } = require('../slug');
const { PUBLIC_URL, DATA_DIR } = require('../config');

// Multer upload up to 80 MB in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024 // 80 MB
  }
});

// Protect all /api/menus* routes with requirePerm('menus:read') or 'menus:write'
router.use(requirePerm('menus:read'));

/**
 * Shared helper to parse, process images, and persist a menu from buffer
 */
async function processAndSaveMenu({ fileBuffer, fileName, customName, menuId }) {
  let existingMenu = null;
  if (menuId) {
    existingMenu = await db.getMenuById(menuId);
    if (!existingMenu) {
      const err = new Error('Target menu to replace was not found.');
      err.statusCode = 404;
      throw err;
    }
  }

  let name = sanitizeString(customName || (existingMenu ? existingMenu.name : 'Digital Menu'), 100);
  if (!name) name = 'Digital Menu';

  // Parse the uploaded file (zip, json, csv)
  const { categories, items, imageJobs } = await parseUploadedMenuFile(fileBuffer, fileName);

  const targetMenuId = existingMenu ? existingMenu.id : `menu_${crypto.randomBytes(6).toString('hex')}`;
  const targetSlug = existingMenu ? existingMenu.slug : generateSlug(name);
  const newImageVersion = `v${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  // Process matched images with Sharp
  const processedItemIds = await processBatchImages(targetMenuId, newImageVersion, imageJobs);

  // Update item image boolean and embedded thumbnail based on actual Sharp processing results
  for (const item of items) {
    item.image = processedItemIds.has(item.id);
    if (processedItemIds.thumbMap && processedItemIds.thumbMap.has(item.id)) {
      item.thumbData = processedItemIds.thumbMap.get(item.id);
    }
  }

  const now = new Date().toISOString();
  const updatedMenu = {
    id: targetMenuId,
    slug: targetSlug,
    name,
    tagline: existingMenu?.tagline || 'Fresh flavors, crafted daily',
    address: existingMenu?.address || '',
    phone: existingMenu?.phone || '',
    currency: existingMenu?.currency || 'INR',
    footnote: existingMenu?.footnote || 'All items prepared fresh. Taxes and service charges as applicable.',
    published: true, // A new upload or replace is published immediately
    imageVersion: newImageVersion,
    categories,
    items,
    customization: existingMenu?.customization || null,
    createdAt: existingMenu ? existingMenu.createdAt : now,
    updatedAt: now
  };

  await db.saveMenu(updatedMenu);

  // If replacing existing menu, safely delete old image version folder
  if (existingMenu && existingMenu.imageVersion) {
    await deleteOldImageVersion(targetMenuId, existingMenu.imageVersion);
  }

  return {
    menu: {
      ...updatedMenu,
      publicUrl: `${PUBLIC_URL}/m/${updatedMenu.slug}`
    },
    isReplace: !!existingMenu
  };
}

/**
 * GET /api/menus - List all menus
 */
router.get('/', async (req, res) => {
  try {
    const menus = await db.listMenus();
    const summaries = menus.map(m => {
      const firstDish = m.items?.find(it => it.image);
      const coverImage = firstDish?.thumbData
        ? firstDish.thumbData
        : (firstDish && m.imageVersion
          ? `/media/${m.slug}/${m.imageVersion}/${firstDish.id}-thumb.webp`
          : null);

      return {
        id: m.id,
        name: m.name,
        slug: m.slug,
        tagline: m.tagline || '',
        address: m.address || '',
        phone: m.phone || '',
        currency: m.currency || 'INR',
        footnote: m.footnote || '',
        published: !!m.published,
        itemCount: Array.isArray(m.items) ? m.items.length : 0,
        categoryCount: Array.isArray(m.categories) ? m.categories.length : 0,
        imageVersion: m.imageVersion || null,
        coverImage,
        customization: m.customization || null,
        publicUrl: `${PUBLIC_URL}/m/${m.slug}`,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt
      };
    });
    res.json({ menus: summaries });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * GET /api/menus/storage/status - Get active storage provider and health
 */
router.get('/storage/status', async (req, res) => {
  try {
    const status = db.getStorageStatus();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * GET /api/menus/export/backup - Export all menus as a complete JSON backup
 */
router.get('/export/backup', async (req, res) => {
  try {
    const menus = await db.listMenus();
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      generator: 'Fundamentzz Digital Menu Vault',
      count: menus.length,
      menus
    };
    const jsonStr = JSON.stringify(backup, null, 2);
    const dateStr = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="fundamentzz-menus-backup-${dateStr}.json"`);
    res.send(jsonStr);
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * POST /api/menus/import/restore - Restore menus from backup payload
 */
router.post('/import/restore', requirePerm('menus:write'), async (req, res) => {
  try {
    const payload = req.body || {};
    const menusToRestore = Array.isArray(payload.menus)
      ? payload.menus
      : (payload.id ? [payload] : []);

    if (menusToRestore.length === 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'No valid menus found in backup payload.' });
    }

    let restored = 0;
    for (const m of menusToRestore) {
      if (m && m.id && m.name) {
        if (!m.slug) m.slug = generateSlug(m.name);
        m.updatedAt = new Date().toISOString();
        await db.saveMenu(m);
        restored++;
      }
    }

    res.json({
      ok: true,
      restoredCount: restored,
      message: `Successfully restored and persisted ${restored} menus.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * POST /api/menus/sync/vault - Two-way sync between browser admin vault and server
 */
router.post('/sync/vault', requirePerm('menus:write'), async (req, res) => {
  try {
    const payload = req.body || {};
    const clientMenus = Array.isArray(payload.menus) ? payload.menus : [];
    if (clientMenus.length === 0) {
      const current = await db.listMenus();
      return res.json({ ok: true, syncedCount: 0, totalMenus: current.length });
    }

    const currentMenus = await db.listMenus();
    const currentMap = new Map(currentMenus.map(m => [m.id, m]));

    let synced = 0;
    for (const cm of clientMenus) {
      if (!cm || !cm.id || !cm.name) continue;
      const existing = currentMap.get(cm.id);
      if (!existing || (cm.updatedAt && new Date(cm.updatedAt) > new Date(existing.updatedAt || 0))) {
        await db.saveMenu(cm);
        currentMap.set(cm.id, cm);
        synced++;
      }
    }

    res.json({
      ok: true,
      syncedCount: synced,
      totalMenus: currentMap.size,
      message: synced > 0 ? `Synced ${synced} menus from Admin Vault.` : 'All menus up to date.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * GET /api/menus/:id - Get single menu
 */
router.get('/:id', async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }
    res.json({
      menu: {
        ...menu,
        publicUrl: `${PUBLIC_URL}/m/${menu.slug}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * POST /api/menus/upload - Upload new menu or replace existing (single request)
 */
router.post('/upload', requirePerm('menus:write'), (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Bad Request', message: 'File size exceeds maximum limit of 80 MB.' });
      }
      return res.status(400).json({ error: 'Bad Request', message: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    const { menuId, name } = req.body || {};
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Bad Request', message: 'Please select a menu file (.zip, .json, or .csv) to upload.' });
    }

    const result = await processAndSaveMenu({
      fileBuffer: file.buffer,
      fileName: file.originalname,
      customName: name,
      menuId
    });

    res.json({
      ok: true,
      message: result.isReplace ? 'Menu content replaced successfully' : 'New menu uploaded and published',
      menu: result.menu
    });
  } catch (err) {
    const status = err.statusCode || 400;
    res.status(status).json({ error: 'Upload Failed', message: err.message });
  }
});

/**
 * POST /api/menus/upload-chunk - Upload file in 3 MB chunks to bypass Vercel 4.5 MB gateway limit
 */
router.post('/upload-chunk', requirePerm('menus:write'), (req, res, next) => {
  upload.single('chunk')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Bad Request', message: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, fileName, name, menuId } = req.body || {};
    const chunkFile = req.file;

    if (!uploadId || chunkIndex === undefined || !totalChunks || !chunkFile) {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing required chunk parameters.' });
    }

    const cIndex = parseInt(chunkIndex, 10);
    const tChunks = parseInt(totalChunks, 10);

    const safeUploadId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, '');
    const chunkDir = path.join(DATA_DIR, 'chunks', safeUploadId);
    await fs.promises.mkdir(chunkDir, { recursive: true });

    // Write chunk part to disk
    const chunkPath = path.join(chunkDir, `${cIndex}.part`);
    await fs.promises.writeFile(chunkPath, chunkFile.buffer);

    // Check if all chunks from 0 to tChunks - 1 are present
    const existingParts = await fs.promises.readdir(chunkDir);
    if (existingParts.length < tChunks) {
      return res.json({
        ok: true,
        chunkReceived: cIndex,
        totalReceived: existingParts.length,
        totalChunks: tChunks
      });
    }

    // All chunks received! Verify and assemble in order.
    const buffers = [];
    for (let i = 0; i < tChunks; i++) {
      const partFile = path.join(chunkDir, `${i}.part`);
      if (!fs.existsSync(partFile)) {
        return res.json({
          ok: true,
          chunkReceived: cIndex,
          waitingFor: i
        });
      }
      const partBuf = await fs.promises.readFile(partFile);
      buffers.push(partBuf);
    }

    const fullBuffer = Buffer.concat(buffers);

    // Clean up temporary chunks
    try {
      for (const p of existingParts) {
        await fs.promises.unlink(path.join(chunkDir, p)).catch(() => {});
      }
      await fs.promises.rmdir(chunkDir).catch(() => {});
    } catch (_) {}

    // Process and save assembled menu file
    const result = await processAndSaveMenu({
      fileBuffer: fullBuffer,
      fileName: fileName || 'menu.zip',
      customName: name,
      menuId
    });

    res.json({
      ok: true,
      message: result.isReplace ? 'Menu content replaced successfully' : 'New menu uploaded and published',
      menu: result.menu
    });
  } catch (err) {
    const status = err.statusCode || 400;
    res.status(status).json({ error: 'Upload Failed', message: err.message });
  }
});

/**
 * PATCH /api/menus/:id - Update menu settings
 */
router.patch('/:id', requirePerm('menus:write'), async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    const { name, tagline, address, phone, currency, footnote, published, customization } = req.body || {};

    if (name !== undefined) menu.name = sanitizeString(name, 100) || menu.name;
    if (tagline !== undefined) menu.tagline = sanitizeString(tagline, 200);
    if (address !== undefined) menu.address = sanitizeString(address, 200);
    if (phone !== undefined) menu.phone = sanitizeString(phone, 40);
    if (currency !== undefined) menu.currency = sanitizeString(currency, 10) || 'INR';
    if (footnote !== undefined) menu.footnote = sanitizeString(footnote, 300);
    if (published !== undefined) menu.published = Boolean(published);

    if (customization !== undefined) {
      if (customization === null) {
        menu.customization = null;
      } else if (typeof customization === 'object') {
        const cur = menu.customization || {};
        menu.customization = {
          enabled: customization.enabled !== undefined ? Boolean(customization.enabled) : (cur.enabled ?? false),
          logo: customization.logo !== undefined ? (typeof customization.logo === 'string' ? customization.logo.trim() : null) : (cur.logo || null),
          theme: sanitizeString(customization.theme || cur.theme || 'emerald', 30),
          primaryColor: sanitizeString(customization.primaryColor || cur.primaryColor || '#059669', 20),
          secondaryColor: sanitizeString(customization.secondaryColor || cur.secondaryColor || '#10b981', 20),
          bgGlowColor: sanitizeString(customization.bgGlowColor || cur.bgGlowColor || '#10b981', 40),
          fontFamily: sanitizeString(customization.fontFamily || cur.fontFamily || 'serif', 30)
        };
      }
    }

    menu.updatedAt = new Date().toISOString();
    await db.saveMenu(menu);

    res.json({
      ok: true,
      message: 'Menu details updated',
      menu: {
        ...menu,
        publicUrl: `${PUBLIC_URL}/m/${menu.slug}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * POST /api/menus/:id/logo - Upload & optimize custom restaurant logo
 */
router.post('/:id/logo', requirePerm('menus:write'), (req, res, next) => {
  upload.single('logo')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Bad Request', message: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Bad Request', message: 'Please select a logo image to upload.' });
    }

    const fileBuf = req.file.buffer;
    const mime = (req.file.mimetype || '').toLowerCase();
    let logoDataUri = '';

    if (mime === 'image/svg+xml') {
      const svgText = fileBuf.toString('utf8');
      logoDataUri = `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
    } else {
      const optimizedBuf = await sharp(fileBuf)
        .rotate()
        .resize({ width: 360, height: 360, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      logoDataUri = `data:image/webp;base64,${optimizedBuf.toString('base64')}`;
    }

    if (!menu.customization) {
      menu.customization = { enabled: true, theme: 'emerald', fontFamily: 'serif' };
    }
    menu.customization.logo = logoDataUri;
    menu.updatedAt = new Date().toISOString();
    await db.saveMenu(menu);

    res.json({
      ok: true,
      message: 'Logo uploaded successfully',
      logo: logoDataUri,
      customization: menu.customization
    });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * DELETE /api/menus/:id/logo - Remove restaurant logo
 */
router.delete('/:id/logo', requirePerm('menus:write'), async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    if (menu.customization) {
      menu.customization.logo = null;
      menu.updatedAt = new Date().toISOString();
      await db.saveMenu(menu);
    }

    res.json({ ok: true, message: 'Logo removed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * POST /api/menus/:id/rotate-link - Make a new unguessable slug and invalidate old link
 */
router.post('/:id/rotate-link', requirePerm('menus:write'), async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    const oldSlug = menu.slug;
    menu.slug = generateSlug(menu.name);
    menu.updatedAt = new Date().toISOString();

    await db.saveMenu(menu);

    res.json({
      ok: true,
      message: 'Link rotated successfully',
      oldSlug,
      newSlug: menu.slug,
      publicUrl: `${PUBLIC_URL}/m/${menu.slug}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * PATCH /api/menus/:id/items/:itemId - Update single dish item
 */
router.patch('/:id/items/:itemId', requirePerm('menus:write'), async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    const item = menu.items?.find(it => it.id === req.params.itemId);
    if (!item) {
      return res.status(404).json({ error: 'Not Found', message: 'Item not found' });
    }

    const { name, price, description, available, unit, categoryId } = req.body || {};

    if (name !== undefined) item.name = sanitizeString(name, 100) || item.name;
    if (price !== undefined) item.price = parsePrice(price);
    if (description !== undefined) item.description = sanitizeString(description, 500);
    if (available !== undefined) item.available = parseAvailable(available);
    if (unit !== undefined) item.unit = sanitizeString(unit, 20);
    if (categoryId !== undefined && menu.categories?.some(c => c.id === categoryId)) {
      item.categoryId = categoryId;
    }

    menu.updatedAt = new Date().toISOString();
    await db.saveMenu(menu);

    res.json({ ok: true, item, message: 'Dish updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * DELETE /api/menus/:id/items/:itemId - Delete single dish item
 */
router.delete('/:id/items/:itemId', requirePerm('menus:write'), async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    const initLen = menu.items?.length || 0;
    menu.items = menu.items?.filter(it => it.id !== req.params.itemId) || [];

    if (menu.items.length === initLen) {
      return res.status(404).json({ error: 'Not Found', message: 'Item not found' });
    }

    menu.updatedAt = new Date().toISOString();
    await db.saveMenu(menu);

    res.json({ ok: true, message: 'Dish deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * PATCH /api/menus/:id/categories/:catId - Update category
 */
router.patch('/:id/categories/:catId', requirePerm('menus:write'), async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    const cat = menu.categories?.find(c => c.id === req.params.catId);
    if (!cat) {
      return res.status(404).json({ error: 'Not Found', message: 'Category not found' });
    }

    const { name } = req.body || {};
    if (name !== undefined) {
      cat.name = sanitizeString(name, 80) || cat.name;
    }

    menu.updatedAt = new Date().toISOString();
    await db.saveMenu(menu);

    res.json({ ok: true, category: cat, message: 'Category updated' });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * DELETE /api/menus/:id - Delete menu
 */
router.delete('/:id', requirePerm('menus:write'), async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).json({ error: 'Not Found', message: 'Menu not found' });
    }

    await db.deleteMenu(req.params.id);
    res.json({ ok: true, message: 'Menu deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server Error', message: err.message });
  }
});

/**
 * GET /api/menus/:id/qr.svg - Generate QR code SVG with ?download=1 option
 */
router.get('/:id/qr.svg', async (req, res) => {
  try {
    const menu = await db.getMenuById(req.params.id);
    if (!menu) {
      return res.status(404).send('Menu not found');
    }

    const menuUrl = `${PUBLIC_URL}/m/${menu.slug}`;
    const svg = await QRCode.toString(menuUrl, {
      type: 'svg',
      margin: 2,
      color: {
        dark: '#0e2a1c',   // Banana-leaf green
        light: '#f4efe2'  // Rice-flour ivory
      }
    });

    res.type('image/svg+xml');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${menu.slug}-qr.svg"`);
    }

    res.send(svg);
  } catch (err) {
    res.status(500).send('Error generating QR code');
  }
});

module.exports = router;

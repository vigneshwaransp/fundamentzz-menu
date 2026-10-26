const express = require('express');
const router = express.Router();
const multer = require('multer');
const QRCode = require('qrcode');
const crypto = require('crypto');
const db = require('../db');
const { requirePerm } = require('../middleware');
const { parseUploadedMenuFile, sanitizeString, parsePrice, parseAvailable } = require('../parser');
const { processBatchImages, deleteOldImageVersion } = require('../images');
const { generateSlug } = require('../slug');
const { PUBLIC_URL } = require('../config');

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
 * GET /api/menus - List all menus
 */
router.get('/', async (req, res) => {
  try {
    const menus = await db.listMenus();
    const summaries = menus.map(m => {
      const firstDish = m.items?.find(it => it.image);
      const coverImage = firstDish && m.imageVersion
        ? `/media/${m.slug}/${m.imageVersion}/${firstDish.id}-thumb.webp`
        : null;

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
 * POST /api/menus/upload - Upload new menu or replace existing
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
    const { menuId } = req.body || {};
    let { name } = req.body || {};
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'Bad Request', message: 'Please select a menu file (.zip, .json, or .csv) to upload.' });
    }

    let existingMenu = null;
    if (menuId) {
      existingMenu = await db.getMenuById(menuId);
      if (!existingMenu) {
        return res.status(404).json({ error: 'Not Found', message: 'Target menu to replace was not found.' });
      }
    }

    name = sanitizeString(name || (existingMenu ? existingMenu.name : 'Digital Menu'), 100);
    if (!name) name = 'Digital Menu';

    // Parse the uploaded file (zip, json, csv)
    const { categories, items, imageJobs } = await parseUploadedMenuFile(file.buffer, file.originalname);

    const targetMenuId = existingMenu ? existingMenu.id : `menu_${crypto.randomBytes(6).toString('hex')}`;
    const targetSlug = existingMenu ? existingMenu.slug : generateSlug(name);
    const newImageVersion = `v${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

    // Process matched images with Sharp
    const processedItemIds = await processBatchImages(targetMenuId, newImageVersion, imageJobs);

    // Update item image boolean based on actual Sharp processing results
    for (const item of items) {
      item.image = processedItemIds.has(item.id);
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
      createdAt: existingMenu ? existingMenu.createdAt : now,
      updatedAt: now
    };

    await db.saveMenu(updatedMenu);

    // If replacing existing menu, safely delete old image version folder
    if (existingMenu && existingMenu.imageVersion) {
      await deleteOldImageVersion(targetMenuId, existingMenu.imageVersion);
    }

    res.json({
      ok: true,
      message: existingMenu ? 'Menu content replaced successfully' : 'New menu uploaded and published',
      menu: {
        ...updatedMenu,
        publicUrl: `${PUBLIC_URL}/m/${updatedMenu.slug}`
      }
    });
  } catch (err) {
    res.status(400).json({ error: 'Upload Failed', message: err.message });
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

    const { name, tagline, address, phone, currency, footnote, published } = req.body || {};

    if (name !== undefined) menu.name = sanitizeString(name, 100) || menu.name;
    if (tagline !== undefined) menu.tagline = sanitizeString(tagline, 200);
    if (address !== undefined) menu.address = sanitizeString(address, 200);
    if (phone !== undefined) menu.phone = sanitizeString(phone, 40);
    if (currency !== undefined) menu.currency = sanitizeString(currency, 10) || 'INR';
    if (footnote !== undefined) menu.footnote = sanitizeString(footnote, 300);
    if (published !== undefined) menu.published = Boolean(published);

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

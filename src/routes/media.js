const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { attachUser } = require('../middleware');
const { hasPermission } = require('../auth');

const FILE_REGEX = /^[a-zA-Z0-9_-]+\.webp$/;
const VERSION_REGEX = /^[a-zA-Z0-9_-]+$/;

router.get('/:slug/:version/:file', attachUser, async (req, res) => {
  const { slug, version, file } = req.params;

  // Strict regex validation preventing path traversal
  if (!FILE_REGEX.test(file) || !VERSION_REGEX.test(version)) {
    return res.status(404).send('Not Found');
  }

  const menu = await db.getMenuBySlug(slug);
  if (!menu) {
    return res.status(404).send('Not Found');
  }

  // Allow image serving if menu is published, or if viewed by authenticated owner
  const isOwner = req.user && hasPermission(req.user, 'menus:read');
  if (!menu.published && !isOwner) {
    return res.status(404).send('Not Found');
  }

  const safeDir = path.join(db.MENUS_DIR, path.basename(menu.id), 'img', path.basename(version));
  const safeFilePath = path.join(safeDir, path.basename(file));

  // Ensure filePath does not escape safeDir
  if (!safeFilePath.startsWith(safeDir)) {
    return res.status(404).send('Not Found');
  }

  try {
    await fs.promises.access(safeFilePath, fs.constants.R_OK);
  } catch (err) {
    // Cross-container serverless fallback:
    // If the file is not on this lambda's /tmp disk, check if dish has embedded thumbData
    const itemId = file.replace(/(-thumb)?\.webp$/, '');
    const dish = (menu.items || []).find(it => it.id === itemId);
    const dataUri = dish?.imageData || dish?.thumbData;
    if (dataUri && dataUri.startsWith('data:image/webp;base64,')) {
      const b64 = dataUri.slice('data:image/webp;base64,'.length);
      const buf = Buffer.from(b64, 'base64');
      try {
        await fs.promises.mkdir(safeDir, { recursive: true });
        await fs.promises.writeFile(safeFilePath, buf);
      } catch (_) {}
      res.setHeader('Content-Type', 'image/webp');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(buf);
    }
    return res.status(404).send('Not Found');
  }

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(safeFilePath);
});

module.exports = router;

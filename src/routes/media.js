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
    return res.status(404).send('Not Found');
  }

  res.setHeader('Content-Type', 'image/webp');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(safeFilePath);
});

module.exports = router;

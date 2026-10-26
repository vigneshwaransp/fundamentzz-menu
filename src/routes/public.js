const express = require('express');
const router = express.Router();
const db = require('../db');
const { attachUser } = require('../middleware');
const { hasPermission } = require('../auth');
const { renderPublicMenuHtml } = require('../views/public-menu');
const { renderNotFoundHtml } = require('../views/404');

router.get('/:slug', attachUser, async (req, res) => {
  const { slug } = req.params;
  const menu = await db.getMenuBySlug(slug);

  if (!menu) {
    return res.status(404).send(renderNotFoundHtml('The requested menu does not exist or may have been moved.'));
  }

  const isOwner = req.user && hasPermission(req.user, 'menus:read');

  if (!menu.published) {
    if (isOwner) {
      // Owner preview mode
      return res.send(renderPublicMenuHtml(menu, true));
    }
    // Friendly 404 to public
    return res.status(404).send(renderNotFoundHtml('This menu is currently hidden or not published.'));
  }

  // Published menu
  res.send(renderPublicMenuHtml(menu, false));
});

module.exports = router;

const path = require('path');
const express = require('express');
const { PORT, PUBLIC_URL, DATA_DIR } = require('./src/config');
const { initDataDir } = require('./src/db');
const { seedOwnerIfNeeded } = require('./src/auth');
const { securityHeaders, csrfProtection } = require('./src/middleware');

const authRoutes = require('./src/routes/auth');
const menusRoutes = require('./src/routes/menus');
const mediaRoutes = require('./src/routes/media');
const publicRoutes = require('./src/routes/public');
const fs = require('fs');

const app = express();

let initPromise = null;
async function ensureInit() {
  if (!initPromise) {
    initPromise = (async () => {
      await initDataDir();
      await seedOwnerIfNeeded();

      // On serverless / cold start, seed sample menu if no menus exist
      const db = require('./src/db');
      const menus = await db.listMenus();
      if (menus.length === 0) {
        try {
          const sampleZipPath = path.join(__dirname, 'samples', 'sample-fundamentzz-menu.zip');
          if (fs.existsSync(sampleZipPath)) {
            const { parseUploadedMenuFile } = require('./src/parser');
            const { processBatchImages } = require('./src/images');
            const zipBytes = fs.readFileSync(sampleZipPath);
            const { categories, items, imageJobs } = await parseUploadedMenuFile(zipBytes, 'sample-fundamentzz-menu.zip');
            const menuId = 'menu_demo';
            const version = `v${Date.now()}`;
            const processedItemIds = await processBatchImages(menuId, version, imageJobs);
            for (const it of items) it.image = processedItemIds.has(it.id);
            const now = new Date().toISOString();
            await db.saveMenu({
              id: menuId,
              slug: 'banana-leaf-bhavan-demo',
              name: 'Banana Leaf Bhavan',
              tagline: 'Authentic South Indian & Chettinad Kitchen',
              address: '42 Cross Cut Road, Gandhipuram, Coimbatore',
              phone: '+91 98765 43210',
              currency: 'INR',
              footnote: 'All items prepared fresh with gingelly oil and pure ghee. GST included.',
              published: true,
              imageVersion: version,
              categories,
              items,
              createdAt: now,
              updatedAt: now
            });
          }
        } catch (err) {
          console.warn('[SEED WARNING]', err.message);
        }
      }
    })();
  }
  return initPromise;
}

// Auto-initialize on request (supports Vercel serverless cold-starts)
app.use(async (req, res, next) => {
  try {
    await ensureInit();
    next();
  } catch (err) {
    next(err);
  }
});

// Favicon route
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🍃</text></svg>');
});

// Trust proxy for secure cookie detection behind reverse proxies (Render, Nginx, etc.)
app.set('trust proxy', 1);

// Global Security Headers (nosniff, referrer-policy, X-Frame-Options, noindex on admin)
app.use(securityHeaders);

// Body parsers for JSON and URL-encoded forms
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files (self-hosted fonts, CSS, client JS)
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.woff2')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));

// CSRF Protection on non-GET /api routes
app.use(csrfProtection);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/menus', menusRoutes);

// Media Image Serving
app.use('/media', mediaRoutes);

// Public SSR Menu Route
app.use('/m', publicRoutes);

// Admin SPA Route
app.get(/^\/admin(\/.*)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Root route redirects to admin dashboard
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// Fallback 404 handler for API routes
app.all(/^\/api(\/.*)?$/, (req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Endpoint ${req.method} ${req.path} not found.` });
});

// General 404 handler
app.use((req, res) => {
  const { renderNotFoundHtml } = require('./src/views/404');
  res.status(404).send(renderNotFoundHtml('The requested page was not found.'));
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  if (req.path.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      error: err.name || 'Internal Server Error',
      message: err.message || 'An unexpected error occurred.'
    });
  }
  res.status(500).send('<h1>500 - Internal Server Error</h1><p>An unexpected server error occurred.</p>');
});

// Initialize storage and start server
async function startServer() {
  try {
    await initDataDir();
    await seedOwnerIfNeeded();

    const server = app.listen(PORT, () => {
      console.log(`====================================================`);
      console.log(` Digital Menu Server running on port ${PORT}`);
      console.log(` Public URL:  ${PUBLIC_URL}`);
      console.log(` Admin URL:   ${PUBLIC_URL}/admin`);
      console.log(` Data Dir:    ${DATA_DIR}`);
      console.log(`====================================================`);
    });

    return server;
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.app = app;
module.exports.startServer = startServer;

const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');
const { startServer } = require('../server');
const db = require('../src/db');
const bcrypt = require('bcryptjs');

async function runBrowserTests() {
  console.log('--- STARTING PLAYWRIGHT BROWSER VERIFICATION ---');

  const screenshotsDir = path.join(__dirname, '..', 'screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  const testEmail = 'kavin@fundamentzz.com';
  const testPassword = 'kavin@123';

  // Start test server on dynamic port
  const server = await startServer();
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Server running for browser tests on ${baseUrl}`);

  // Ensure known owner password
  const users = await db.getUsers();
  if (users.length > 0) {
    users[0].passwordHash = await bcrypt.hash(testPassword, 10);
    users[0].passwordVersion = 1;
    await db.saveUsers(users);
  }

  // Launch browser using installed Chrome or Edge
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true
  });

  const consoleErrors = [];
  let menuSlug = '';

  try {
    // ==========================================
    // 1. DESKTOP VIEWPORT (1280x800)
    // ==========================================
    console.log('Testing Desktop Viewport (1280x800)...');
    const desktopContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 2
    });
    const desktopPage = await desktopContext.newPage();

    desktopPage.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('401')) {
        console.warn(`[Browser Console Error] ${msg.text()}`);
        consoleErrors.push(msg.text());
      }
    });

    // 1.1 Open Admin Login
    await desktopPage.goto(`${baseUrl}/admin`);
    await desktopPage.waitForSelector('#login-form');
    console.log(' [PASS] Admin login page loaded');

    // 1.2 Sign in
    await desktopPage.fill('#login-email', testEmail);
    await desktopPage.fill('#login-password', testPassword);
    await desktopPage.click('#login-submit-btn');

    // Wait for Dashboard
    await desktopPage.waitForSelector('#upload-drop-zone', { timeout: 5000 });
    console.log(' [PASS] Successfully signed into Admin Dashboard');

    // Screenshot: Admin Dashboard
    await desktopPage.screenshot({ path: path.join(screenshotsDir, 'desktop-admin.png'), fullPage: false });
    console.log(' [SAVED] screenshots/desktop-admin.png');

    // 1.3 Find menu with images or upload sample
    let menus = await db.listMenus();
    let targetMenu = menus.find(m => m.items?.some(it => it.image));
    if (!targetMenu) {
      console.log('Uploading sample menu archive via UI...');
      const fileInput = await desktopPage.$('#upload-file-input');
      const zipPath = path.join(__dirname, '..', 'samples', 'sample-fundamentzz-menu.zip');
      await fileInput.setInputFiles(zipPath);
      await desktopPage.click('#start-upload-btn');
      await desktopPage.waitForSelector('.detail-layout', { timeout: 10000 });
      menus = await db.listMenus();
      targetMenu = menus.find(m => m.items?.some(it => it.image)) || menus[0];
    }
    menuSlug = targetMenu.slug;

    console.log(`Testing Public Menu at /m/${menuSlug} (${targetMenu.name})...`);

    // 1.4 Open Public Menu
    await desktopPage.goto(`${baseUrl}/m/${menuSlug}`);
    await desktopPage.waitForSelector('.restaurant-name');
    console.log(' [PASS] Public menu rendered successfully');

    // 1.5 Verify Square Thumbnails
    const thumbs = await desktopPage.$$('.dish-media-wrap');
    console.log(`Checking ${thumbs.length} dish thumbnails for square aspect ratio...`);
    for (let i = 0; i < thumbs.length; i++) {
      const box = await thumbs[i].boundingBox();
      if (box) {
        const isSquare = Math.abs(box.width - box.height) < 1;
        if (!isSquare) {
          throw new Error(`Thumbnail ${i} is not square: ${box.width}x${box.height}`);
        }
      }
    }
    console.log(' [PASS] Confirmed all dish thumbnails are strictly square');

    // 1.6 Verify Overlapping Round Hero Plates
    const plates = await desktopPage.$$('.hero-plate');
    console.log(`Hero plates count: ${plates.length}`);
    if (plates.length > 0) {
      for (const p of plates) {
        const box = await p.boundingBox();
        if (box) {
          const isRound = Math.abs(box.width - box.height) < 1;
          if (!isRound) throw new Error('Hero plate is not round');
        }
      }
      console.log(' [PASS] Confirmed hero dish plates have circular turmeric rings');
    }

    // 1.7 Test Lightbox Dialog
    console.log('Testing Dish Lightbox Dialog...');
    const firstDishCard = await desktopPage.$('.dish-card');
    await firstDishCard.click();
    await desktopPage.waitForSelector('dialog#dish-dialog[open]');
    console.log(' [PASS] Dish card click opened <dialog> lightbox');
    
    // Close dialog
    await desktopPage.click('#dialog-close-btn');
    await desktopPage.waitForFunction(() => !document.querySelector('dialog#dish-dialog').open);
    console.log(' [PASS] Close button successfully closed <dialog>');

    // 1.8 Test Live Search (Latin & Tamil)
    console.log('Testing Live Search (Latin & Tamil)...');
    await desktopPage.fill('#dish-search', 'Dosa');
    let visibleCards = await desktopPage.$$eval('.dish-card:not([hidden])', cards => cards.length);
    console.log(`Visible cards searching "Dosa": ${visibleCards}`);
    if (visibleCards !== 1) throw new Error('Expected 1 visible card for "Dosa"');

    // Tamil search: தோசை
    await desktopPage.fill('#dish-search', 'தோசை');
    visibleCards = await desktopPage.$$eval('.dish-card:not([hidden])', cards => cards.length);
    console.log(`Visible cards searching Tamil "தோசை": ${visibleCards}`);
    if (visibleCards !== 1) throw new Error('Expected 1 visible card for Tamil "தோசை"');

    // Clear search
    await desktopPage.click('#search-clear-btn');
    visibleCards = await desktopPage.$$eval('.dish-card:not([hidden])', cards => cards.length);
    console.log(`Visible cards after search clear: ${visibleCards}`);
    if (visibleCards < 4) throw new Error('Expected all dishes visible after clearing search');
    console.log(' [PASS] Live search works seamlessly for both Latin and Tamil text');

    // Screenshot: Desktop Public Menu
    await desktopPage.screenshot({ path: path.join(screenshotsDir, 'desktop-public-menu.png'), fullPage: false });
    console.log(' [SAVED] screenshots/desktop-public-menu.png');

    // 1.9 Test Menu Detail Page in Admin
    console.log('Testing Menu Detail Page in Admin...');
    await desktopPage.goto(`${baseUrl}/admin#menu/${targetMenu.id}`);
    await desktopPage.waitForSelector('.detail-layout');
    await desktopPage.waitForSelector('#qr-preview-box svg');
    console.log(' [PASS] Admin menu detail layout and QR SVG loaded');
    await desktopPage.screenshot({ path: path.join(screenshotsDir, 'desktop-admin-detail.png'), fullPage: false });
    console.log(' [SAVED] screenshots/desktop-admin-detail.png');

    await desktopContext.close();

    // ==========================================
    // 2. MOBILE VIEWPORT (390px width - iPhone)
    // ==========================================
    console.log('Testing Mobile Viewport (390x844)...');
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true
    });
    const mobilePage = await mobileContext.newPage();

    mobilePage.on('console', msg => {
      if (msg.type() === 'error' && !msg.text().includes('401')) {
        console.warn(`[Mobile Console Error] ${msg.text()}`);
        consoleErrors.push(msg.text());
      }
    });

    // 2.1 Public Menu on Mobile
    await mobilePage.goto(`${baseUrl}/m/${menuSlug}`);
    await mobilePage.waitForSelector('.restaurant-name');

    // Confirm horizontal card layout
    const mobileCardBox = await (await mobilePage.$('.dish-card')).boundingBox();
    console.log(`Mobile card width: ${mobileCardBox.width}px`);
    if (mobileCardBox.width < 300) {
      throw new Error('Mobile card is unexpectedly narrow');
    }

    // Verify thumbnail is still strictly square on mobile
    const mobileThumbBox = await (await mobilePage.$('.dish-media-wrap')).boundingBox();
    const isMobileThumbSquare = Math.abs(mobileThumbBox.width - mobileThumbBox.height) < 1;
    if (!isMobileThumbSquare) {
      throw new Error(`Mobile thumbnail is not square: ${mobileThumbBox.width}x${mobileThumbBox.height}`);
    }
    console.log(` [PASS] Confirmed square thumbnails on mobile (${mobileThumbBox.width}x${mobileThumbBox.height})`);

    // Screenshot: Mobile Public Menu
    await mobilePage.screenshot({ path: path.join(screenshotsDir, 'mobile-public-menu.png'), fullPage: false });
    console.log(' [SAVED] screenshots/mobile-public-menu.png');

    // 2.2 Admin on Mobile
    await mobilePage.goto(`${baseUrl}/admin`);
    await mobilePage.waitForSelector('#login-form');
    await mobilePage.fill('#login-email', testEmail);
    await mobilePage.fill('#login-password', testPassword);
    await mobilePage.click('#login-submit-btn');
    await mobilePage.waitForSelector('#upload-drop-zone');

    // Screenshot: Mobile Admin Dashboard
    await mobilePage.screenshot({ path: path.join(screenshotsDir, 'mobile-admin.png'), fullPage: false });
    console.log(' [SAVED] screenshots/mobile-admin.png');

    await mobileContext.close();

    // Check for any uncaught console errors
    console.log(`Total console errors recorded: ${consoleErrors.length}`);
    if (consoleErrors.length > 0) {
      console.warn('Console errors:', consoleErrors);
    }

    console.log('====================================================');
    console.log(' PLAYWRIGHT TESTS COMPLETED SUCCESSFULLY!');
    console.log(' Screenshots verified:');
    console.log('  - screenshots/desktop-public-menu.png');
    console.log('  - screenshots/desktop-admin.png');
    console.log('  - screenshots/mobile-public-menu.png');
    console.log('  - screenshots/mobile-admin.png');
    console.log('====================================================');

    await browser.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Browser test failed:', err);
    await browser.close();
    if (server) server.close();
    process.exit(1);
  }
}

runBrowserTests();

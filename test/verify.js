const http = require('http');
const fs = require('fs');
const path = require('path');
const { app, startServer } = require('../server');
const { DATA_DIR, SESSION_COOKIE_NAME } = require('../src/config');
const db = require('../src/db');

let server;
let baseUrl;

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });
    req.on('error', reject);
    if (body) {
      if (Buffer.isBuffer(body)) {
        req.write(body);
      } else if (typeof body === 'object') {
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

function parseSetCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return null;
  const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = cookieStr.match(/([^=]+)=([^;]+)/);
  return match ? { name: match[1], value: match[2], raw: cookieStr } : null;
}

async function runTests() {
  console.log('--- STARTING COMPREHENSIVE VERIFICATION SUITE ---');
  
  const bcrypt = require('bcryptjs');
  const testEmail = 'owner@fundamentzz.local';
  const testPassword = 'supersecretownerpassword123';

  server = await startServer();
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server running on ${baseUrl}`);

  // Set known test password on the seeded user
  const users = await db.getUsers();
  if (users.length > 0) {
    users[0].passwordHash = await bcrypt.hash(testPassword, 10);
    users[0].passwordVersion = 1;
    await db.saveUsers(users);
  }

  let passed = 0;
  let failed = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(` [PASS] ${message}`);
      passed++;
    } else {
      console.error(` [FAIL] ${message}`);
      failed++;
    }
  }

  try {
    // 1. Security Headers
    const secRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/admin',
      method: 'GET'
    });
    assert(secRes.headers['x-content-type-options'] === 'nosniff', 'Security header: X-Content-Type-Options: nosniff');
    assert(secRes.headers['x-frame-options'] === 'DENY', 'Security header: X-Frame-Options: DENY');
    assert(secRes.headers['referrer-policy'] === 'strict-origin-when-cross-origin', 'Security header: Referrer-Policy present');
    assert(secRes.headers['x-robots-tag'] === 'noindex, nofollow', 'Security header: X-Robots-Tag: noindex, nofollow on /admin');

    // 2. Anonymous requests to /api/menus return 401
    const anonRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus',
      method: 'GET'
    });
    assert(anonRes.status === 401, 'Anonymous GET /api/menus returns 401 Unauthorized');

    // 3. Anonymous upload to /api/menus/upload returns 401
    const anonUpload = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus/upload',
      method: 'POST',
      headers: {
        'X-Requested-With': 'dm'
      }
    });
    assert(anonUpload.status === 401, 'Anonymous POST /api/menus/upload returns 401');

    // 4. Requests without CSRF header return 403
    const noCsrfRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }, { email: testEmail, password: 'wrong' });
    assert(noCsrfRes.status === 403, 'POST /api/auth/login without CSRF header returns 403 Forbidden');

    // 5. Wrong password returns 401
    const wrongPassRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'dm'
      }
    }, { email: testEmail, password: 'wrongpassword' });
    assert(wrongPassRes.status === 401, 'Login with wrong password returns 401 Unauthorized');

    // 6. Unknown email returns 401 (with timing check)
    const unknownEmailRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'dm'
      }
    }, { email: 'nonexistent@test.local', password: 'anypassword' });
    assert(unknownEmailRes.status === 401, 'Login with unknown email returns 401 Unauthorized');

    // 7. Successful login returns cookie
    const loginRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'dm'
      }
    }, { email: testEmail, password: 'supersecretownerpassword123' });
    assert(loginRes.status === 200, 'Login with correct credentials returns 200 OK');
    
    const cookie = parseSetCookie(loginRes.headers);
    assert(cookie && cookie.name === SESSION_COOKIE_NAME, 'Session cookie dm_session received');
    assert(cookie.raw.includes('HttpOnly'), 'Cookie has HttpOnly flag');
    assert(cookie.raw.includes('SameSite=Strict'), 'Cookie has SameSite=Strict flag');
    const validSessionCookie = `${cookie.name}=${cookie.value}`;

    // 8. Tampered cookie is rejected with 401
    const tamperedCookie = `${cookie.name}=${cookie.value}tampered`;
    const tamperedRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus',
      method: 'GET',
      headers: {
        'Cookie': tamperedCookie
      }
    });
    assert(tamperedRes.status === 401, 'Tampered cookie is rejected with 401 Unauthorized');

    // 9. Valid session accesses GET /api/menus
    const authMenusRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus',
      method: 'GET',
      headers: {
        'Cookie': validSessionCookie
      }
    });
    assert(authMenusRes.status === 200, 'Authenticated GET /api/menus returns 200 OK');

    // 10. Upload a real Fundamentzz ZIP archive
    console.log('Testing multipart upload of sample-fundamentzz-menu.zip...');
    const zipPath = path.join(__dirname, '..', 'samples', 'sample-fundamentzz-menu.zip');
    const zipBytes = fs.readFileSync(zipPath);
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);

    let multipartBody = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nBanana Leaf Bhavan\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample-fundamentzz-menu.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      zipBytes,
      Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const uploadRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': multipartBody.length,
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, multipartBody);

    assert(uploadRes.status === 200, 'POST /api/menus/upload returns 200 OK');
    const uploadedMenu = uploadRes.json?.menu;
    assert(uploadedMenu && uploadedMenu.id, 'Uploaded menu returned with ID');
    assert(uploadedMenu?.items?.length === 6, `All 6 dishes imported (found: ${uploadedMenu?.items?.length})`);
    
    // Verify Fundamentzz parsing specifics:
    // - empty category c4 was skipped
    assert(uploadedMenu?.categories?.length === 3, 'Empty category skipped: exactly 3 active categories retained');
    // - selling_price mapped to price
    const dosa = uploadedMenu?.items?.find(it => it.name.includes('Dosa'));
    assert(dosa && dosa.price === 110, 'selling_price mapped to price (110)');
    // - portion unit hidden, pcs unit shown
    assert(dosa?.unit === '', 'unit "portion" is hidden (empty string)');
    const vada = uploadedMenu?.items?.find(it => it.name.includes('Vada'));
    assert(vada && vada.unit === '2 pcs', 'unit "2 pcs" is preserved');
    // - sold-out state
    const meals = uploadedMenu?.items?.find(it => it.name.includes('Meals'));
    assert(meals && meals.available === false, 'Banana Leaf Meals correctly marked available=false');
    // - images processed by Sharp
    assert(dosa && dosa.image === true, 'Dish image processed with Sharp (image: true)');

    const menuId = uploadedMenu.id;
    const initialSlug = uploadedMenu.slug;
    const initialVersion = uploadedMenu.imageVersion;

    // 11. Public link renders SSR HTML
    const publicRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/m/${initialSlug}`,
      method: 'GET'
    });
    assert(publicRes.status === 200, `GET /m/${initialSlug} returns 200 OK`);
    assert(publicRes.body.includes('Banana Leaf Bhavan'), 'Public HTML contains restaurant name');
    assert(publicRes.body.includes('og:image'), 'Public HTML contains Open Graph og:image tag');
    assert(publicRes.body.includes('Sold out · தீர்ந்தது'), 'Public HTML contains "Sold out · தீர்ந்தது" state');
    assert(publicRes.body.includes('hero-plate'), 'Public HTML contains hero plates with staggered animation');

    // 12. Media image serving
    const mediaRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/media/${initialSlug}/${initialVersion}/${dosa.id}.webp`,
      method: 'GET'
    });
    assert(mediaRes.status === 200, 'GET /media/:slug/:version/:file returns 200 OK');
    assert(mediaRes.headers['content-type'] === 'image/webp', 'Media served with Content-Type: image/webp');
    assert(mediaRes.headers['cache-control']?.includes('immutable'), 'Media served with immutable caching headers');

    // 13. Path traversal attempt on /media returns 404
    const traversalRes1 = await request({
      hostname: '127.0.0.1',
      port,
      path: `/media/${initialSlug}/${initialVersion}/..%2f..%2fusers.json`,
      method: 'GET'
    });
    assert(traversalRes1.status === 404, 'Path traversal /..%2f..%2f returns 404');

    const traversalRes2 = await request({
      hostname: '127.0.0.1',
      port,
      path: `/media/${initialSlug}/${initialVersion}/invalid.php`,
      method: 'GET'
    });
    assert(traversalRes2.status === 404, 'Non-webp or invalid filename on /media returns 404');

    // 14. Hide makes public link 404 while owner preview still works
    console.log('Testing Hide / Preview functionality...');
    const hideRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, { published: false });
    assert(hideRes.status === 200, 'PATCH menu published: false returns 200');

    // Anonymous visitor gets 404
    const anonHiddenRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/m/${initialSlug}`,
      method: 'GET'
    });
    assert(anonHiddenRes.status === 404, 'Unpublished menu returns friendly 404 to public visitor');

    // Signed-in owner gets 200 with Preview banner
    const ownerPreviewRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/m/${initialSlug}`,
      method: 'GET',
      headers: {
        'Cookie': validSessionCookie
      }
    });
    assert(ownerPreviewRes.status === 200, 'Unpublished menu returns 200 to signed-in owner');
    assert(ownerPreviewRes.body.includes('preview-banner'), 'Owner sees Preview banner');

    // Restore published = true
    await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, { published: true });

    // 15. Rotate-link makes old link 404 and new link 200
    console.log('Testing Rotate Link...');
    const rotateRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}/rotate-link`,
      method: 'POST',
      headers: {
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    });
    assert(rotateRes.status === 200, 'POST /api/menus/:id/rotate-link returns 200 OK');
    const newSlug = rotateRes.json?.newSlug;
    assert(newSlug && newSlug !== initialSlug, `New slug generated: ${newSlug}`);

    // Old slug is now 404
    const oldSlugRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/m/${initialSlug}`,
      method: 'GET'
    });
    assert(oldSlugRes.status === 404, 'Old slug returns 404 Not Found');

    // New slug is 200
    const newSlugRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/m/${newSlug}`,
      method: 'GET'
    });
    assert(newSlugRes.status === 200, 'New rotated slug returns 200 OK');

    // 16. Replace menu keeps same slug and deletes old image folder
    console.log('Testing Menu Replace...');
    const oldVersionDir = path.join(DATA_DIR, 'menus', menuId, 'img', initialVersion);
    assert(fs.existsSync(oldVersionDir), `Old image version directory exists before replace: ${initialVersion}`);

    let replaceBoundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    let replaceMultipartBody = Buffer.concat([
      Buffer.from(`--${replaceBoundary}\r\nContent-Disposition: form-data; name="menuId"\r\n\r\n${menuId}\r\n`),
      Buffer.from(`--${replaceBoundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nBanana Leaf Bhavan\r\n`),
      Buffer.from(`--${replaceBoundary}\r\nContent-Disposition: form-data; name="file"; filename="sample-fundamentzz-menu.zip"\r\nContent-Type: application/zip\r\n\r\n`),
      zipBytes,
      Buffer.from(`\r\n--${replaceBoundary}--\r\n`)
    ]);

    const replaceRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${replaceBoundary}`,
        'Content-Length': replaceMultipartBody.length,
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, replaceMultipartBody);

    assert(replaceRes.status === 200, 'Replace upload returns 200 OK');
    const replacedMenu = replaceRes.json?.menu;
    assert(replacedMenu.slug === newSlug, `Replace preserves the exact same slug (${newSlug})`);
    assert(replacedMenu.imageVersion !== initialVersion, `New image version generated (${replacedMenu.imageVersion})`);
    
    // Verify old image folder was deleted
    const oldDirStillExists = fs.existsSync(oldVersionDir);
    assert(!oldDirStillExists, 'Old image version directory was deleted after successful replace');

    // 17. CSV upload works
    console.log('Testing CSV upload...');
    const csvPath = path.join(__dirname, '..', 'samples', 'sample-menu.csv');
    const csvBytes = fs.readFileSync(csvPath);
    let csvBoundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    let csvMultipart = Buffer.concat([
      Buffer.from(`--${csvBoundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nChennai Tiffin Centre\r\n`),
      Buffer.from(`--${csvBoundary}\r\nContent-Disposition: form-data; name="file"; filename="sample-menu.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      csvBytes,
      Buffer.from(`\r\n--${csvBoundary}--\r\n`)
    ]);

    const csvUploadRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${csvBoundary}`,
        'Content-Length': csvMultipart.length,
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, csvMultipart);

    assert(csvUploadRes.status === 200, 'CSV upload returns 200 OK');
    assert(csvUploadRes.json?.menu?.items?.length === 4, 'CSV correctly imported 4 items');

    // 18. Bad file type returns clear error
    const badFileBoundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const badFileMultipart = Buffer.concat([
      Buffer.from(`--${badFileBoundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nBad Menu\r\n`),
      Buffer.from(`--${badFileBoundary}\r\nContent-Disposition: form-data; name="file"; filename="document.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
      Buffer.from('%PDF-1.4 dummy pdf'),
      Buffer.from(`\r\n--${badFileBoundary}--\r\n`)
    ]);

    const badFileRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus/upload',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${badFileBoundary}`,
        'Content-Length': badFileMultipart.length,
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, badFileMultipart);

    assert(badFileRes.status === 400, 'Bad file type returns 400 Bad Request');
    assert(badFileRes.json?.message?.includes('.zip, .json, or .csv'), `Clear error message returned: "${badFileRes.json?.message}"`);

    // 18b. Test Chunked Upload (/api/menus/upload-chunk)
    const sampleZip = path.join(__dirname, '..', 'samples', 'sample-fundamentzz-menu.zip');
    const zipBytesForChunk = fs.readFileSync(sampleZip);
    const midPoint = Math.floor(zipBytesForChunk.length / 2);
    const chunk0 = zipBytesForChunk.slice(0, midPoint);
    const chunk1 = zipBytesForChunk.slice(midPoint);
    const testUploadId = 'test_upl_' + Date.now();

    // Send Chunk 0
    const chunk0Boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const chunk0Body = Buffer.concat([
      Buffer.from(`--${chunk0Boundary}\r\nContent-Disposition: form-data; name="uploadId"\r\n\r\n${testUploadId}\r\n`),
      Buffer.from(`--${chunk0Boundary}\r\nContent-Disposition: form-data; name="chunkIndex"\r\n\r\n0\r\n`),
      Buffer.from(`--${chunk0Boundary}\r\nContent-Disposition: form-data; name="totalChunks"\r\n\r\n2\r\n`),
      Buffer.from(`--${chunk0Boundary}\r\nContent-Disposition: form-data; name="fileName"\r\n\r\nsample-fundamentzz-menu.zip\r\n`),
      Buffer.from(`--${chunk0Boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nChunked Menu\r\n`),
      Buffer.from(`--${chunk0Boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="part0"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      chunk0,
      Buffer.from(`\r\n--${chunk0Boundary}--\r\n`)
    ]);

    const chunk0Res = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus/upload-chunk',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${chunk0Boundary}`,
        'Content-Length': chunk0Body.length,
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, chunk0Body);

    assert(chunk0Res.status === 200, 'Chunk 0 upload returns 200 OK');
    assert(chunk0Res.json?.chunkReceived === 0, 'Chunk 0 acknowledged by server');

    // Send Chunk 1 (final chunk)
    const chunk1Boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
    const chunk1Body = Buffer.concat([
      Buffer.from(`--${chunk1Boundary}\r\nContent-Disposition: form-data; name="uploadId"\r\n\r\n${testUploadId}\r\n`),
      Buffer.from(`--${chunk1Boundary}\r\nContent-Disposition: form-data; name="chunkIndex"\r\n\r\n1\r\n`),
      Buffer.from(`--${chunk1Boundary}\r\nContent-Disposition: form-data; name="totalChunks"\r\n\r\n2\r\n`),
      Buffer.from(`--${chunk1Boundary}\r\nContent-Disposition: form-data; name="fileName"\r\n\r\nsample-fundamentzz-menu.zip\r\n`),
      Buffer.from(`--${chunk1Boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nChunked Menu\r\n`),
      Buffer.from(`--${chunk1Boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="part1"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      chunk1,
      Buffer.from(`\r\n--${chunk1Boundary}--\r\n`)
    ]);

    const chunk1Res = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus/upload-chunk',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${chunk1Boundary}`,
        'Content-Length': chunk1Body.length,
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, chunk1Body);

    assert(chunk1Res.status === 200, 'Final chunk upload returns 200 OK');
    assert(chunk1Res.json?.menu?.id, 'Chunked menu successfully assembled and created');
    assert(chunk1Res.json?.menu?.items?.length === 6, 'Chunked menu items successfully processed');

    // 19. QR SVG download
    const qrRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}/qr.svg?download=1`,
      method: 'GET',
      headers: {
        'Cookie': validSessionCookie
      }
    });
    assert(qrRes.status === 200, 'GET /api/menus/:id/qr.svg?download=1 returns 200 OK');
    assert(qrRes.headers['content-type']?.includes('image/svg+xml'), 'QR Content-Type contains image/svg+xml');
    assert(qrRes.headers['content-disposition']?.includes('attachment'), 'Content-Disposition attachment set for download');
    assert(qrRes.body.includes('<svg'), 'QR response contains valid SVG');

    // 20. Customization & Logo Branding
    console.log('Testing Menu Customization & Logo Branding...');
    // Create a 1x1 transparent PNG buffer for logo test
    const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const logoBoundary = '----WebKitFormBoundaryLogo' + Math.random().toString(36).slice(2);
    const logoMultipart = Buffer.concat([
      Buffer.from(`--${logoBoundary}\r\nContent-Disposition: form-data; name="logo"; filename="test-logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      dummyPng,
      Buffer.from(`\r\n--${logoBoundary}--\r\n`)
    ]);

    const logoUploadRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}/logo`,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${logoBoundary}`,
        'Content-Length': logoMultipart.length,
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, logoMultipart);
    assert(logoUploadRes.status === 200, 'POST /api/menus/:id/logo returns 200 OK');
    assert(logoUploadRes.json?.ok === true, 'Logo upload response ok');
    assert(logoUploadRes.json?.logo?.startsWith('data:image/webp;base64,'), 'Logo stored as WebP Data URI');

    // Update customization settings with custom colors and font
    const patchCustRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, {
      customization: {
        enabled: true,
        theme: 'sapphire',
        primaryColor: '#2563eb',
        bgGlowColor: '#3b82f6',
        fontFamily: 'display'
      }
    });
    assert(patchCustRes.status === 200, 'PATCH /api/menus/:id with customization returns 200 OK');
    assert(patchCustRes.json?.menu?.customization?.enabled === true, 'Customization enabled is true');
    assert(patchCustRes.json?.menu?.customization?.theme === 'sapphire', 'Customization theme is sapphire');

    // Verify Public HTML renders custom theme and logo
    const custPublicRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/m/${newSlug}`,
      method: 'GET'
    });
    assert(custPublicRes.status === 200, 'Customized menu GET returns 200 OK');
    assert(custPublicRes.body.includes('id="custom-menu-theme"'), 'Public menu includes custom theme style tag');
    assert(custPublicRes.body.includes('--color-accent: #2563eb'), 'Public menu includes custom accent color');
    assert(custPublicRes.body.includes('class="hero-logo-badge"'), 'Public menu renders hero logo badge');

    // Test slider toggle OFF: customization disabled
    const toggleOffRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}`,
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, {
      customization: {
        enabled: false
      }
    });
    assert(toggleOffRes.status === 200, 'Toggle slider OFF returns 200 OK');
    assert(toggleOffRes.json?.menu?.customization?.enabled === false, 'Customization enabled is false');

    const toggleOffPublic = await request({
      hostname: '127.0.0.1',
      port,
      path: `/m/${newSlug}`,
      method: 'GET'
    });
    assert(!toggleOffPublic.body.includes('id="custom-menu-theme"'), 'When toggled OFF, custom style tag is omitted');
    assert(!toggleOffPublic.body.includes('class="hero-logo-badge"'), 'When toggled OFF, hero logo badge is omitted');

    // Test DELETE logo
    const delLogoRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}/logo`,
      method: 'DELETE',
      headers: {
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    });
    assert(delLogoRes.status === 200, 'DELETE /api/menus/:id/logo returns 200 OK');

    // Test DELETE menu
    console.log('Testing Menu Deletion / Removal...');
    const delMenuRes = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}`,
      method: 'DELETE',
      headers: {
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    });
    assert(delMenuRes.status === 200, 'DELETE /api/menus/:id returns 200 OK');

    const verifyDeleted = await request({
      hostname: '127.0.0.1',
      port,
      path: `/api/menus/${menuId}`,
      method: 'GET',
      headers: {
        'Cookie': validSessionCookie
      }
    });
    assert(verifyDeleted.status === 404, 'Deleted menu returns 404 Not Found');

    // 21. Changing password invalidates old sessions
    console.log('Testing password change and session invalidation...');
    const changePassRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': validSessionCookie,
        'X-Requested-With': 'dm'
      }
    }, {
      oldPassword: 'supersecretownerpassword123',
      newPassword: 'brandnewownerpassword456'
    });
    assert(changePassRes.status === 200, 'POST /api/auth/password returns 200 OK');

    // Now, the old session cookie must be rejected
    const oldSessionAttempt = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/menus',
      method: 'GET',
      headers: {
        'Cookie': validSessionCookie
      }
    });
    assert(oldSessionAttempt.status === 401, 'Old session cookie is invalidated after password change (returns 401)');

    // Login with new password works
    const newLoginRes = await request({
      hostname: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'dm'
      }
    }, {
      email: testEmail,
      password: 'brandnewownerpassword456'
    });
    assert(newLoginRes.status === 200, 'Login with new password succeeds');

    // Restore password to default test password so tests do not mutate local storage permanently
    const resetUsers = await db.getUsers();
    if (resetUsers.length > 0) {
      resetUsers[0].passwordHash = await bcrypt.hash(testPassword, 10);
      resetUsers[0].passwordVersion = 1;
      await db.saveUsers(resetUsers);
    }

    console.log('====================================================');
    console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log('====================================================');

    server.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('Test error:', err);
    if (server) server.close();
    process.exit(1);
  }
}

runTests();

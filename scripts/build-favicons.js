const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// 1. Master Favicon SVG (Squircle badge with rich contrast for browser tabs & bookmarks)
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="badge-bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#064e3b"/>
      <stop offset="50%" stop-color="#022c22"/>
      <stop offset="100%" stop-color="#011812"/>
    </linearGradient>
    <linearGradient id="badge-border" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399" stop-opacity="0.8"/>
      <stop offset="50%" stop-color="#10b981" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#059669" stop-opacity="0.2"/>
    </linearGradient>
    <linearGradient id="leaf-main" x1="20%" y1="10%" x2="80%" y2="90%">
      <stop offset="0%" stop-color="#6ee7b7"/>
      <stop offset="30%" stop-color="#34d399"/>
      <stop offset="70%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#047857"/>
    </linearGradient>
    <linearGradient id="leaf-sec" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a7f3d0"/>
      <stop offset="50%" stop-color="#34d399"/>
      <stop offset="100%" stop-color="#059669"/>
    </linearGradient>
    <linearGradient id="gold-acc" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="40%" stop-color="#fbbf24"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <filter id="soft-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Ambient Glow & Squircle Base -->
  <rect x="2" y="2" width="60" height="60" rx="18" fill="url(#badge-bg)"/>
  <rect x="2" y="2" width="60" height="60" rx="18" fill="none" stroke="url(#badge-border)" stroke-width="1.8"/>

  <!-- Subtle ambient inner light -->
  <circle cx="32" cy="28" r="16" fill="#10b981" opacity="0.16" filter="url(#soft-glow)"/>

  <!-- Elegant culinary plate base arc -->
  <path d="M16 46.5C24 49.8 40 49.8 48 46.5" stroke="url(#gold-acc)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="32" cy="48.2" r="1.6" fill="url(#gold-acc)"/>

  <!-- Left Accent Leaf (Botanical curve) -->
  <path d="M31 38C22 37 17.5 31 18.5 23C19.5 18 24 15 28 15C27 20 28 26 31 30C32 32 32 37 31 38Z" fill="url(#leaf-sec)" opacity="0.9"/>

  <!-- Primary Gourmet Leaf -->
  <path d="M33 13C43 16 47 26 44 36C42 41 37 45 31 44C34 40 36 34 35 27C34 20 31 16 33 13Z" fill="url(#leaf-main)"/>

  <!-- Center vein highlight -->
  <path d="M25 42C28.5 38 31 31.5 32 20" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-opacity="0.85"/>

  <!-- Golden 4-point culinary star -->
  <path d="M43 13L44.2 16.5L47.5 17.7L44.2 18.9L43 22.2L41.8 18.9L38.5 17.7L41.8 16.5Z" fill="url(#gold-acc)"/>
</svg>`;

// 2. Transparent Brand Emblem SVG (For navbar, login header, banners, watermarks)
const BRAND_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">
  <defs>
    <linearGradient id="bl-main" x1="20%" y1="10%" x2="80%" y2="90%">
      <stop offset="0%" stop-color="#34d399"/>
      <stop offset="35%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#047857"/>
    </linearGradient>
    <linearGradient id="bl-sec" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6ee7b7"/>
      <stop offset="60%" stop-color="#059669"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
    <linearGradient id="bl-gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde68a"/>
      <stop offset="40%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
    <filter id="bl-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#047857" flood-opacity="0.25"/>
    </filter>
  </defs>

  <g filter="url(#bl-shadow)">
    <!-- Base Culinary Arc -->
    <path d="M14 48C22 51.5 42 51.5 50 48" stroke="url(#bl-gold)" stroke-width="2.8" stroke-linecap="round"/>
    <circle cx="32" cy="49.8" r="1.8" fill="url(#bl-gold)"/>

    <!-- Left Accent Leaf -->
    <path d="M31 38C21 37 16 30 17 21C18 16 23 13 27 13C26 19 28 25 31 29C32 31 32 37 31 38Z" fill="url(#bl-sec)" opacity="0.92"/>

    <!-- Main Botanical Leaf -->
    <path d="M33 11C44 14 49 25 46 36C44 42 38 46 31 45C34 41 36 34 35 26C34 18 31 14 33 11Z" fill="url(#bl-main)"/>

    <!-- Leaf Vein Highlight -->
    <path d="M24 43C28 38 31 31 32 18" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-opacity="0.9"/>

    <!-- Sparkle Star -->
    <path d="M45 11L46.3 14.8L50 16.2L46.3 17.6L45 21.4L43.7 17.6L40 16.2L43.7 14.8Z" fill="url(#bl-gold)"/>
  </g>
</svg>`;

async function buildAll() {
  const publicDir = path.join(__dirname, '..', 'public');
  const imgDir = path.join(publicDir, 'img');
  if (!fs.existsSync(imgDir)) {
    fs.mkdirSync(imgDir, { recursive: true });
  }

  // 1. Write public/favicon.svg
  const faviconSvgPath = path.join(publicDir, 'favicon.svg');
  fs.writeFileSync(faviconSvgPath, FAVICON_SVG, 'utf8');
  console.log('✓ Created', faviconSvgPath);

  // 2. Write public/img/brand-logo.svg
  const brandLogoPath = path.join(imgDir, 'brand-logo.svg');
  fs.writeFileSync(brandLogoPath, BRAND_LOGO_SVG, 'utf8');
  console.log('✓ Created', brandLogoPath);

  // 3. Write public/img/favicon-badge.svg
  const badgeSvgPath = path.join(imgDir, 'favicon-badge.svg');
  fs.writeFileSync(badgeSvgPath, FAVICON_SVG, 'utf8');
  console.log('✓ Created', badgeSvgPath);

  // 4. Generate PNG raster icons for apple-touch-icon, PWA & multi-resolution ICO
  const svgBuf = Buffer.from(FAVICON_SVG, 'utf8');
  const sizes = [16, 32, 48, 180, 192, 512];
  const pngBuffers = {};

  for (const s of sizes) {
    pngBuffers[s] = await sharp(svgBuf).resize(s, s).png().toBuffer();
  }

  // Apple touch icon
  const appleTouchPath = path.join(publicDir, 'apple-touch-icon.png');
  fs.writeFileSync(appleTouchPath, pngBuffers[180]);
  console.log('✓ Created', appleTouchPath);

  // PWA icons
  fs.writeFileSync(path.join(publicDir, 'icon-192.png'), pngBuffers[192]);
  fs.writeFileSync(path.join(publicDir, 'icon-512.png'), pngBuffers[512]);
  console.log('✓ Created PWA icons 192 & 512');

  // Build binary multi-resolution .ico (16x16, 32x32, 48x48)
  const icoSizes = [16, 32, 48];
  const count = icoSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4); // image count

  let offset = 6 + (count * 16);
  const entries = [];
  const imageBuffers = [];

  for (const s of icoSizes) {
    const imgData = pngBuffers[s];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(s === 256 ? 0 : s, 0); // width
    entry.writeUInt8(s === 256 ? 0 : s, 1); // height
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(imgData.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // file offset

    entries.push(entry);
    imageBuffers.push(imgData);
    offset += imgData.length;
  }

  const icoBuffer = Buffer.concat([header, ...entries, ...imageBuffers]);
  const icoPath = path.join(publicDir, 'favicon.ico');
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('✓ Created multi-resolution binary ICO at', icoPath, `(${icoBuffer.length} bytes)`);

  console.log('All favicon & SVG assets successfully built!');
}

buildAll().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});

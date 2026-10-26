const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { MENUS_DIR } = require('./db');

/**
 * Run async operations with a concurrency limit (e.g. 4)
 */
async function runWithConcurrency(items, concurrency, workerFn) {
  const results = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      try {
        results[idx] = await workerFn(items[idx], idx);
      } catch (err) {
        results[idx] = { ok: false, error: err };
      }
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Process a single image buffer into:
 * 1) 1000px-wide webp (auto-rotated)
 * 2) 520x520 cover-cropped webp thumbnail (auto-rotated)
 * 3) Lightweight Base64 data URI (~220x220, quality 75) for 100% resilient serverless rendering
 */
async function processDishImage(imageBuffer, outputDir, itemId) {
  try {
    const largePath = path.join(outputDir, `${itemId}.webp`);
    const thumbPath = path.join(outputDir, `${itemId}-thumb.webp`);

    // Auto-rotate, max 1000px width
    await sharp(imageBuffer)
      .rotate()
      .resize({ width: 1000, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(largePath);

    // Auto-rotate, 520x520 cover cropped
    await sharp(imageBuffer)
      .rotate()
      .resize(520, 520, { fit: 'cover' })
      .webp({ quality: 82 })
      .toFile(thumbPath);

    // Self-contained embedded thumbnail (~220x220, quality 75)
    // Ensures zero 404s on serverless lambda multi-container deployments
    let thumbData = null;
    try {
      const miniBuf = await sharp(imageBuffer)
        .rotate()
        .resize(220, 220, { fit: 'cover' })
        .webp({ quality: 75 })
        .toBuffer();
      thumbData = `data:image/webp;base64,${miniBuf.toString('base64')}`;
    } catch (_) {}

    return { ok: true, itemId, thumbData };
  } catch (err) {
    // Unreadable or corrupted image leaves dish text-only
    console.warn(`[IMAGE PIPELINE] Could not process image for item ${itemId}: ${err.message}`);
    return { ok: false, itemId, error: err.message };
  }
}

/**
 * Process all matched dish images for a menu import
 * @param {string} menuId
 * @param {string} newVersion
 * @param {Array<{ itemId: string, buffer: Buffer }>} imageJobs
 * @returns {Promise<Set<string>>} Set of itemIds that successfully processed (with .thumbMap attached)
 */
async function processBatchImages(menuId, newVersion, imageJobs) {
  const versionDir = path.join(MENUS_DIR, path.basename(menuId), 'img', path.basename(newVersion));
  await fs.promises.mkdir(versionDir, { recursive: true });

  const successfulItemIds = new Set();
  const thumbMap = new Map();
  successfulItemIds.thumbMap = thumbMap;

  if (!imageJobs || imageJobs.length === 0) {
    return successfulItemIds;
  }

  // Process 4 at a time
  const results = await runWithConcurrency(imageJobs, 4, async (job) => {
    return await processDishImage(job.buffer, versionDir, job.itemId);
  });

  for (const res of results) {
    if (res && res.ok) {
      successfulItemIds.add(res.itemId);
      if (res.thumbData) {
        thumbMap.set(res.itemId, res.thumbData);
      }
    }
  }

  return successfulItemIds;
}

/**
 * Delete an old image version directory
 */
async function deleteOldImageVersion(menuId, oldVersion) {
  if (!menuId || !oldVersion) return;
  const oldDir = path.join(MENUS_DIR, path.basename(menuId), 'img', path.basename(oldVersion));
  try {
    await fs.promises.rm(oldDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[CLEANUP] Could not delete old image folder ${oldDir}: ${err.message}`);
  }
}

module.exports = {
  processDishImage,
  processBatchImages,
  deleteOldImageVersion,
  runWithConcurrency,
};

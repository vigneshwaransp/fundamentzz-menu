const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');

/**
 * Sanitize and length-limit strings
 */
function sanitizeString(str, maxLength) {
  if (typeof str !== 'string' && typeof str !== 'number') return '';
  let s = String(str).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (s.length > maxLength) {
    s = s.slice(0, maxLength).trim();
  }
  return s;
}

/**
 * Clean and parse numeric price
 */
function parsePrice(val) {
  if (typeof val === 'number') {
    return Math.max(0, Math.round(val * 100) / 100);
  }
  if (!val) return 0;
  // Clean currency symbols or spaces
  const numStr = String(val).replace(/[^0-9.]/g, '');
  const parsed = parseFloat(numStr);
  return isNaN(parsed) ? 0 : Math.max(0, Math.round(parsed * 100) / 100);
}

/**
 * Parse boolean availability
 */
function parseAvailable(val) {
  if (val === undefined || val === null) return true;
  const str = String(val).trim().toLowerCase();
  if (str === 'false' || str === '0' || str === 'no' || str === 'sold out' || str === 'soldout') {
    return false;
  }
  return true;
}

/**
 * RFC-4180 compliant CSV parser
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      } else {
        field += char;
        i++;
        continue;
      }
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter(r => r.some(c => c.trim().length > 0));
}

/**
 * Parse Fundamentzz Export JSON
 */
function parseFundamentzzJson(json, imageMap) {
  const rawCats = Array.isArray(json.categories) ? json.categories : [];
  const rawProds = Array.isArray(json.products) ? json.products : [];

  if (rawProds.length === 0) {
    throw new Error('Fundamentzz export does not contain any products.');
  }

  // Count products per category ID to skip empty categories
  const catProductCounts = new Map();
  for (const prod of rawProds) {
    const cId = String(prod.category_id || prod.categoryId || '');
    catProductCounts.set(cId, (catProductCounts.get(cId) || 0) + 1);
  }

  const categoryMap = new Map(); // original id -> normalized category
  const categories = [];

  for (const rc of rawCats) {
    const cId = String(rc.id || '');
    if (!catProductCounts.has(cId) || catProductCounts.get(cId) === 0) {
      // Skip empty category
      continue;
    }
    const catObj = {
      id: `cat_${categories.length + 1}`,
      name: sanitizeString(rc.name || 'General', 80)
    };
    categoryMap.set(cId, catObj);
    categories.push(catObj);
  }

  // Fallback category if product has unknown or missing category_id
  let defaultCat = null;

  const items = [];
  const imageJobs = [];

  for (const p of rawProds) {
    const name = sanitizeString(p.name, 100);
    if (!name) continue;

    const cId = String(p.category_id || p.categoryId || '');
    let category = categoryMap.get(cId);
    if (!category) {
      // Try by category_name
      const cName = sanitizeString(p.category_name || 'General', 80);
      category = categories.find(c => c.name.toLowerCase() === cName.toLowerCase());
      if (!category) {
        if (!defaultCat) {
          defaultCat = { id: `cat_${categories.length + 1}`, name: cName };
          categories.push(defaultCat);
        }
        category = defaultCat;
      }
    }

    const itemId = `itm_${crypto.randomBytes(6).toString('hex')}`;
    const price = parsePrice(p.selling_price ?? p.price);
    
    // Hide unit when it is "portion" and show it otherwise
    const rawUnit = (p.unit || '').trim().toLowerCase();
    const unit = rawUnit === 'portion' ? '' : sanitizeString(p.unit, 20);

    const available = parseAvailable(p.is_available ?? p.available);
    const description = sanitizeString(p.description || '', 500);

    // Image matching
    let hasImage = false;
    const imgFilename = p.image_filename || p.image || '';
    if (imgFilename && imageMap) {
      const baseName = path.basename(imgFilename).toLowerCase();
      if (imageMap.has(baseName)) {
        hasImage = true;
        imageJobs.push({
          itemId,
          buffer: imageMap.get(baseName)
        });
      }
    }

    items.push({
      id: itemId,
      categoryId: category.id,
      name,
      description,
      price,
      unit,
      available,
      image: hasImage
    });
  }

  if (items.length === 0) {
    throw new Error('No valid items found in the menu archive.');
  }

  return { categories, items, imageJobs };
}

/**
 * Parse Generic JSON: categories array with items, or flat items array
 */
function parseGenericJson(json, imageMap) {
  const categories = [];
  const items = [];
  const imageJobs = [];

  const catNameToObj = new Map();

  function getOrCreateCategory(name) {
    const catName = sanitizeString(name || 'General', 80) || 'General';
    const key = catName.toLowerCase();
    if (catNameToObj.has(key)) {
      return catNameToObj.get(key);
    }
    const cat = {
      id: `cat_${categories.length + 1}`,
      name: catName
    };
    catNameToObj.set(key, cat);
    categories.push(cat);
    return cat;
  }

  if (Array.isArray(json)) {
    // Array of categories or array of items
    const isCategoryList = json.length > 0 && Array.isArray(json[0].items);
    if (isCategoryList) {
      for (const catData of json) {
        if (!catData.items || catData.items.length === 0) continue;
        const cat = getOrCreateCategory(catData.name || 'General');
        for (const it of catData.items) {
          addItem(it, cat.id);
        }
      }
    } else {
      // Flat items array
      for (const it of json) {
        const cat = getOrCreateCategory(it.category || it.category_name || 'General');
        addItem(it, cat.id);
      }
    }
  } else if (typeof json === 'object' && json !== null) {
    if (Array.isArray(json.categories)) {
      for (const catData of json.categories) {
        if (!catData.items || catData.items.length === 0) continue;
        const cat = getOrCreateCategory(catData.name || 'General');
        for (const it of catData.items) {
          addItem(it, cat.id);
        }
      }
    } else if (Array.isArray(json.items)) {
      for (const it of json.items) {
        const cat = getOrCreateCategory(it.category || it.category_name || 'General');
        addItem(it, cat.id);
      }
    } else {
      throw new Error('Unrecognized JSON structure. Expected categories or items array.');
    }
  } else {
    throw new Error('Invalid JSON format.');
  }

  function addItem(rawItem, categoryId) {
    const name = sanitizeString(rawItem.name, 100);
    if (!name) return;

    const itemId = `itm_${crypto.randomBytes(6).toString('hex')}`;
    const price = parsePrice(rawItem.price ?? rawItem.selling_price);
    const rawUnit = (rawItem.unit || '').trim().toLowerCase();
    const unit = rawUnit === 'portion' ? '' : sanitizeString(rawItem.unit, 20);
    const available = parseAvailable(rawItem.available ?? rawItem.is_available);
    const description = sanitizeString(rawItem.description || '', 500);

    let hasImage = false;
    const imgFilename = rawItem.image || rawItem.image_filename || '';
    if (imgFilename && imageMap) {
      const baseName = path.basename(imgFilename).toLowerCase();
      if (imageMap.has(baseName)) {
        hasImage = true;
        imageJobs.push({
          itemId,
          buffer: imageMap.get(baseName)
        });
      }
    }

    items.push({
      id: itemId,
      categoryId,
      name,
      description,
      price,
      unit,
      available,
      image: hasImage
    });
  }

  if (items.length === 0) {
    throw new Error('No valid items found in JSON data.');
  }

  return { categories, items, imageJobs };
}

/**
 * Parse CSV format: category,name,price,description,unit,available,image
 */
function parseCsvMenu(csvText, imageMap) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) {
    throw new Error('CSV file is empty or missing data rows.');
  }

  // Header matching
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const colIndex = {
    category: headers.indexOf('category'),
    name: headers.indexOf('name'),
    price: headers.indexOf('price'),
    description: headers.indexOf('description'),
    unit: headers.indexOf('unit'),
    available: headers.indexOf('available'),
    image: headers.indexOf('image'),
  };

  if (colIndex.name === -1 || colIndex.price === -1) {
    throw new Error('CSV must contain at least "name" and "price" columns.');
  }

  const categories = [];
  const items = [];
  const imageJobs = [];
  const catNameToObj = new Map();

  function getOrCreateCategory(name) {
    const catName = sanitizeString(name || 'General', 80) || 'General';
    const key = catName.toLowerCase();
    if (catNameToObj.has(key)) {
      return catNameToObj.get(key);
    }
    const cat = {
      id: `cat_${categories.length + 1}`,
      name: catName
    };
    catNameToObj.set(key, cat);
    categories.push(cat);
    return cat;
  }

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawName = colIndex.name !== -1 ? row[colIndex.name] : '';
    const name = sanitizeString(rawName, 100);
    if (!name) continue;

    const rawCat = colIndex.category !== -1 ? row[colIndex.category] : 'General';
    const category = getOrCreateCategory(rawCat);

    const itemId = `itm_${crypto.randomBytes(6).toString('hex')}`;
    const rawPrice = colIndex.price !== -1 ? row[colIndex.price] : 0;
    const price = parsePrice(rawPrice);

    const rawDesc = colIndex.description !== -1 ? row[colIndex.description] : '';
    const description = sanitizeString(rawDesc, 500);

    const rawUnit = colIndex.unit !== -1 ? (row[colIndex.unit] || '').trim().toLowerCase() : '';
    const unit = rawUnit === 'portion' ? '' : sanitizeString(rawUnit, 20);

    const rawAvail = colIndex.available !== -1 ? row[colIndex.available] : true;
    const available = parseAvailable(rawAvail);

    const rawImg = colIndex.image !== -1 ? (row[colIndex.image] || '').trim() : '';
    let hasImage = false;
    if (rawImg && imageMap) {
      const baseName = path.basename(rawImg).toLowerCase();
      if (imageMap.has(baseName)) {
        hasImage = true;
        imageJobs.push({
          itemId,
          buffer: imageMap.get(baseName)
        });
      }
    }

    items.push({
      id: itemId,
      categoryId: category.id,
      name,
      description,
      price,
      unit,
      available,
      image: hasImage
    });
  }

  if (items.length === 0) {
    throw new Error('No valid items found in CSV data.');
  }

  return { categories, items, imageJobs };
}

/**
 * Main parser entry point: parses Buffer from .zip, .json, or .csv
 */
async function parseUploadedMenuFile(fileBuffer, originalFilename) {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('Uploaded file is empty.');
  }

  const ext = path.extname(originalFilename || '').toLowerCase();

  // 1. ZIP File
  if (ext === '.zip' || fileBuffer.slice(0, 4).toString('hex') === '504b0304') {
    let zip;
    try {
      zip = new AdmZip(fileBuffer);
    } catch (err) {
      throw new Error(`Failed to read zip archive: ${err.message}`);
    }

    const entries = zip.getEntries();
    if (entries.length > 3000) {
      throw new Error(`Zip archive exceeds maximum allowed entries (limit: 3000, found: ${entries.length}).`);
    }

    let totalUncompressed = 0;
    const maxUncompressed = 300 * 1024 * 1024; // 300 MB

    // Collect images and find shallowest data file
    const imageMap = new Map(); // lowercase basename -> Buffer
    let shallowestDataEntry = null;
    let shallowestDepth = Infinity;

    const validImgExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);

    for (const ent of entries) {
      if (ent.isDirectory) continue;
      
      totalUncompressed += ent.header.size;
      if (totalUncompressed > maxUncompressed) {
        throw new Error('Zip uncompressed size exceeds maximum allowed limit of 300 MB.');
      }

      const name = ent.entryName.replace(/\\/g, '/');
      // Skip macOS resource fork files
      if (name.includes('__MACOSX') || path.basename(name).startsWith('.')) {
        continue;
      }

      const entExt = path.extname(name).toLowerCase();
      if (validImgExts.has(entExt)) {
        const baseName = path.basename(name).toLowerCase();
        try {
          imageMap.set(baseName, ent.getData());
        } catch (_) {}
      } else if (entExt === '.json' || entExt === '.csv') {
        const depth = name.split('/').length - 1;
        if (depth < shallowestDepth) {
          shallowestDepth = depth;
          shallowestDataEntry = ent;
        }
      }
    }

    if (!shallowestDataEntry) {
      throw new Error('Zip archive does not contain any valid .json or .csv menu definition file.');
    }

    const dataContent = shallowestDataEntry.getData().toString('utf8');
    const dataExt = path.extname(shallowestDataEntry.entryName).toLowerCase();

    if (dataExt === '.json') {
      let parsed;
      try {
        parsed = JSON.parse(dataContent);
      } catch (e) {
        throw new Error(`Failed to parse JSON file "${shallowestDataEntry.entryName}" in zip: ${e.message}`);
      }

      if (parsed.format === 'fundamentzz_menu_archive') {
        return parseFundamentzzJson(parsed, imageMap);
      } else {
        return parseGenericJson(parsed, imageMap);
      }
    } else {
      return parseCsvMenu(dataContent, imageMap);
    }
  }

  // 2. JSON File
  if (ext === '.json') {
    const text = fileBuffer.toString('utf8');
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new Error(`Malformed JSON file: ${e.message}`);
    }

    if (parsed.format === 'fundamentzz_menu_archive') {
      return parseFundamentzzJson(parsed, null);
    } else {
      return parseGenericJson(parsed, null);
    }
  }

  // 3. CSV File
  if (ext === '.csv') {
    const text = fileBuffer.toString('utf8');
    return parseCsvMenu(text, null);
  }

  throw new Error(`Unsupported file type "${ext || 'unknown'}". Please upload a .zip, .json, or .csv file.`);
}

module.exports = {
  sanitizeString,
  parsePrice,
  parseAvailable,
  parseCSV,
  parseFundamentzzJson,
  parseGenericJson,
  parseCsvMenu,
  parseUploadedMenuFile,
};

const { PUBLIC_URL } = require('../config');

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(amount, currency = 'INR') {
  const num = Number(amount) || 0;
  const digits = num % 1 === 0 ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    }).format(num);
  } catch (_) {
    return `₹${num}`;
  }
}

/**
 * Render the complete server-rendered Public Menu HTML
 */
function renderPublicMenuHtml(menu, isPreview = false) {
  const currency = menu.currency || 'INR';
  const dishesWithImages = (menu.items || []).filter(it => it.image);
  const firstDishWithImage = dishesWithImages[0];

  // Open Graph Image URL
  const ogImage = firstDishWithImage && menu.imageVersion
    ? `${PUBLIC_URL}/media/${menu.slug}/${menu.imageVersion}/${firstDishWithImage.id}.webp`
    : `${PUBLIC_URL}/img/og-fallback.png`;

  const ogTitle = `${menu.name} · Digital Menu`;
  const ogDescription = menu.tagline || (menu.address ? `${menu.name} located at ${menu.address}` : `Explore the digital menu for ${menu.name}`);

  // Up to 5 overlapping dish plates for the hero row
  const heroPlates = dishesWithImages.slice(0, 5);

  // Group items by category
  const categories = menu.categories || [];
  const items = menu.items || [];
  const categoryGroups = categories.map(cat => {
    return {
      ...cat,
      items: items.filter(it => it.categoryId === cat.id)
    };
  }).filter(group => group.items.length > 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(menu.name)} · Digital Menu</title>
  
  <!-- Open Graph / WhatsApp Preview Meta Tags -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${PUBLIC_URL}/m/${escapeHtml(menu.slug)}">
  <meta property="og:title" content="${escapeHtml(ogTitle)}">
  <meta property="og:description" content="${escapeHtml(ogDescription)}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta property="og:image:width" content="1000">
  <meta property="og:image:height" content="750">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(ogTitle)}">
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <meta name="description" content="${escapeHtml(ogDescription)}">

  <!-- Self-hosted Fonts and Stylesheets -->
  <link rel="stylesheet" href="/fonts/fonts.css">
  <link rel="stylesheet" href="/css/base.css">
  <link rel="stylesheet" href="/css/public.css">
</head>
<body class="public-menu-body">
  ${isPreview ? `
    <aside class="preview-banner" role="status" aria-label="Preview notice">
      <div class="preview-banner-inner">
        <span class="preview-badge">Preview</span>
        <span>This menu is unpublished and hidden from the public. Visible to you as owner.</span>
      </div>
    </aside>
  ` : ''}

  <!-- Header & Hero Section -->
  <header class="menu-hero">
    <div class="menu-container hero-container">
      ${heroPlates.length > 0 ? `
        <div class="hero-plates-row" aria-hidden="true">
          ${heroPlates.map((dish, i) => `
            <div class="hero-plate" style="--stagger-delay: ${(i * 0.08).toFixed(2)}s">
              <img src="/media/${escapeHtml(menu.slug)}/${escapeHtml(menu.imageVersion)}/${escapeHtml(dish.id)}-thumb.webp"
                   alt=""
                   loading="eager"
                   width="72"
                   height="72">
            </div>
          `).join('')}
        </div>
      ` : ''}

      <h1 class="restaurant-name">${escapeHtml(menu.name)}</h1>
      
      ${menu.tagline ? `<p class="restaurant-tagline">${escapeHtml(menu.tagline)}</p>` : ''}
      
      <div class="restaurant-meta">
        ${menu.address ? `
          <div class="meta-item address-item">
            <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
            <span>${escapeHtml(menu.address)}</span>
          </div>
        ` : ''}
        
        ${menu.phone ? `
          <div class="meta-item phone-item">
            <a href="tel:${escapeHtml(menu.phone)}" class="phone-link" aria-label="Call ${escapeHtml(menu.name)}">
              <svg class="meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span>${escapeHtml(menu.phone)}</span>
            </a>
          </div>
        ` : ''}
      </div>
    </div>
  </header>

  <!-- Sticky Bar: Live Search & Category Chips -->
  <nav class="sticky-nav" aria-label="Menu navigation">
    <div class="menu-container sticky-nav-inner">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="search"
               id="dish-search"
               class="search-input"
               placeholder="Search dishes · உணவுகளை தேட..."
               aria-label="Search dishes">
        <button type="button" id="search-clear-btn" class="search-clear-btn" aria-label="Clear search" hidden>✕</button>
      </div>

      <div class="categories-scroller" id="categories-scroller" role="tablist" aria-label="Categories">
        ${categoryGroups.map((cat, idx) => `
          <a href="#cat-${escapeHtml(cat.id)}"
             class="category-chip ${idx === 0 ? 'is-active' : ''}"
             id="chip-${escapeHtml(cat.id)}"
             role="tab"
             aria-selected="${idx === 0 ? 'true' : 'false'}">
            ${escapeHtml(cat.name)}
          </a>
        `).join('')}
      </div>
    </div>
  </nav>

  <!-- Main Menu Sections -->
  <main class="menu-container menu-main">
    <div id="empty-search-state" class="empty-search-state" hidden>
      <div class="empty-icon" aria-hidden="true">🌱</div>
      <h3>No dishes match</h3>
      <p class="empty-subtitle">உணவுகள் எதுவும் பொருந்தவில்லை</p>
      <button type="button" id="reset-search-btn" class="btn btn-secondary">Clear search</button>
    </div>

    ${categoryGroups.map(cat => `
      <section class="menu-category-section" id="cat-${escapeHtml(cat.id)}" data-cat-id="${escapeHtml(cat.id)}">
        <h2 class="category-heading">${escapeHtml(cat.name)}</h2>
        
        <div class="dishes-grid">
          ${cat.items.map(dish => {
            const isSoldOut = !dish.available;
            const formattedPrice = formatPrice(dish.price, currency);
            const unitText = dish.unit ? ` / ${escapeHtml(dish.unit)}` : '';
            const searchText = `${dish.name} ${dish.description || ''}`.toLowerCase();
            const firstLetter = (dish.name || 'D').trim().charAt(0).toUpperCase();

            const largeImgUrl = dish.image && menu.imageVersion
              ? `/media/${escapeHtml(menu.slug)}/${escapeHtml(menu.imageVersion)}/${escapeHtml(dish.id)}.webp`
              : '';
            const thumbImgUrl = dish.image && menu.imageVersion
              ? `/media/${escapeHtml(menu.slug)}/${escapeHtml(menu.imageVersion)}/${escapeHtml(dish.id)}-thumb.webp`
              : '';

            return `
              <article class="dish-card ${isSoldOut ? 'is-sold-out' : ''}"
                       data-search-text="${escapeHtml(searchText)}"
                       data-dish-id="${escapeHtml(dish.id)}"
                       data-dish-name="${escapeHtml(dish.name)}"
                       data-dish-price="${escapeHtml(formattedPrice + unitText)}"
                       data-dish-desc="${escapeHtml(dish.description || '')}"
                       data-dish-image="${escapeHtml(largeImgUrl)}"
                       tabindex="0"
                       role="button"
                       aria-haspopup="dialog"
                       aria-label="${escapeHtml(dish.name)}, ${escapeHtml(formattedPrice + unitText)}${isSoldOut ? ', sold out' : ''}">
                <div class="dish-media-wrap">
                  ${dish.image ? `
                    <img src="${escapeHtml(thumbImgUrl)}"
                         alt="${escapeHtml(dish.name)}"
                         class="dish-thumb"
                         loading="lazy"
                         width="110"
                         height="110">
                  ` : `
                    <div class="dish-kolam-placeholder" aria-hidden="true">
                      <span class="kolam-letter">${escapeHtml(firstLetter)}</span>
                    </div>
                  `}
                </div>

                <div class="dish-content">
                  <div class="dish-header">
                    <h3 class="dish-name">${escapeHtml(dish.name)}</h3>
                    <div class="dish-price-wrap">
                      <span class="dish-price">${escapeHtml(formattedPrice)}</span>
                      ${dish.unit ? `<span class="dish-unit">${escapeHtml(dish.unit)}</span>` : ''}
                    </div>
                  </div>

                  ${dish.description ? `
                    <p class="dish-description">${escapeHtml(dish.description)}</p>
                  ` : ''}

                  ${isSoldOut ? `
                    <div class="sold-out-badge">
                      <span class="badge-dot" aria-hidden="true"></span>
                      <span>Sold out · தீர்ந்தது</span>
                    </div>
                  ` : ''}
                </div>
              </article>
            `;
          }).join('')}
        </div>
      </section>
    `).join('')}

    ${menu.footnote ? `
      <footer class="menu-footnote">
        <p>${escapeHtml(menu.footnote)}</p>
      </footer>
    ` : ''}
  </main>

  <!-- Dish Lightbox Dialog -->
  <dialog id="dish-dialog" class="dish-dialog" aria-labelledby="dialog-dish-name">
    <div class="dish-dialog-inner">
      <button type="button" class="dialog-close-btn" id="dialog-close-btn" aria-label="Close dialog">✕</button>
      
      <div id="dialog-img-wrap" class="dialog-img-wrap" hidden>
        <img id="dialog-img" src="" alt="" class="dialog-img">
      </div>

      <div class="dialog-details">
        <div class="dialog-header-row">
          <h2 id="dialog-dish-name" class="dialog-dish-name"></h2>
          <span id="dialog-dish-price" class="dialog-dish-price"></span>
        </div>
        <p id="dialog-dish-desc" class="dialog-dish-desc"></p>
      </div>
    </div>
  </dialog>

  <!-- Client JavaScript for search, sticky nav, dialog -->
  <script src="/js/public.js"></script>
</body>
</html>`;
}

module.exports = {
  renderPublicMenuHtml,
};

function renderNotFoundHtml(message = 'Menu not found or currently unavailable.') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Menu Not Found · Digital Menu</title>
  
  <!-- Modern Vector Favicon & Touch Icons -->
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="alternate icon" href="/favicon.ico">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">

  <link rel="stylesheet" href="/fonts/fonts.css">
  <link rel="stylesheet" href="/css/base.css">
  <style>
    .not-found-body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
      text-align: center;
    }
    .not-found-card {
      background: rgba(255, 255, 255, 0.78);
      backdrop-filter: blur(28px) saturate(190%);
      -webkit-backdrop-filter: blur(28px) saturate(190%);
      border: 1px solid rgba(255, 255, 255, 0.95);
      border-radius: var(--radius-xl);
      padding: 3rem 2.25rem;
      max-width: 460px;
      width: 100%;
      box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.1), inset 0 1px 1px 0 rgba(255, 255, 255, 0.95);
    }
    .not-found-icon {
      font-size: 3.2rem;
      margin-bottom: 1rem;
      display: inline-block;
      filter: drop-shadow(0 4px 10px rgba(5, 150, 105, 0.15));
    }
    .not-found-title {
      font-family: var(--font-heading);
      color: var(--color-text);
      font-size: 1.85rem;
      margin-bottom: 0.35rem;
    }
    .not-found-sub {
      color: var(--color-accent);
      font-size: 1.05rem;
      font-weight: 500;
      margin-bottom: 1.25rem;
    }
    .not-found-desc {
      color: var(--color-text-muted);
      font-size: 0.98rem;
      line-height: 1.55;
      margin-bottom: 2rem;
    }
  </style>
</head>
<body class="not-found-body">
  <div class="not-found-card">
    <div class="not-found-icon">
      <svg width="68" height="68" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="nf-main" x1="20%" y1="10%" x2="80%" y2="90%">
            <stop offset="0%" stop-color="#34d399"/>
            <stop offset="35%" stop-color="#10b981"/>
            <stop offset="100%" stop-color="#047857"/>
          </linearGradient>
          <linearGradient id="nf-sec" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#6ee7b7"/>
            <stop offset="60%" stop-color="#059669"/>
            <stop offset="100%" stop-color="#064e3b"/>
          </linearGradient>
          <linearGradient id="nf-gold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fde68a"/>
            <stop offset="40%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#d97706"/>
          </linearGradient>
        </defs>
        <path d="M14 48C22 51.5 42 51.5 50 48" stroke="url(#nf-gold)" stroke-width="3" stroke-linecap="round"/>
        <circle cx="32" cy="49.8" r="2" fill="url(#nf-gold)"/>
        <path d="M31 38C21 37 16 30 17 21C18 16 23 13 27 13C26 19 28 25 31 29C32 31 32 37 31 38Z" fill="url(#nf-sec)" opacity="0.92"/>
        <path d="M33 11C44 14 49 25 46 36C44 42 38 46 31 45C34 41 36 34 35 26C34 18 31 14 33 11Z" fill="url(#nf-main)"/>
        <path d="M24 43C28 38 31 31 32 18" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-opacity="0.9"/>
        <path d="M45 11L46.3 14.8L50 16.2L46.3 17.6L45 21.4L43.7 17.6L40 16.2L43.7 14.8Z" fill="url(#nf-gold)"/>
      </svg>
    </div>
    <h1 class="not-found-title">Menu not found</h1>
    <p class="not-found-sub">மெனு கிடைக்கவில்லை</p>
    <p class="not-found-desc">${message}</p>
    <a href="/" class="btn btn-primary" style="display:inline-flex; text-decoration:none;">Go home</a>
  </div>
</body>
</html>`;
}

module.exports = {
  renderNotFoundHtml,
};

function renderNotFoundHtml(message = 'Menu not found or currently unavailable.') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Menu Not Found · Digital Menu</title>
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
    <div class="not-found-icon">🍃</div>
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

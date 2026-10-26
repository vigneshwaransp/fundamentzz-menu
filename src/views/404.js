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
      background: var(--color-card);
      border: 1px solid rgba(244, 239, 226, 0.08);
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.35);
    }
    .not-found-icon {
      font-size: 3rem;
      margin-bottom: 1rem;
    }
    .not-found-title {
      font-family: var(--font-heading);
      color: var(--color-text);
      font-size: 1.6rem;
      margin-bottom: 0.5rem;
    }
    .not-found-desc {
      color: var(--color-text-muted);
      font-size: 1rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .not-found-sub {
      color: var(--color-accent);
      font-size: 0.95rem;
      margin-bottom: 1.5rem;
    }
  </style>
</head>
<body class="not-found-body">
  <div class="not-found-card">
    <div class="not-found-icon">🍃</div>
    <h1 class="not-found-title">Menu not found</h1>
    <p class="not-found-sub">மெனு கிடைக்கவில்லை</p>
    <p class="not-found-desc">${message}</p>
    <a href="/" class="btn btn-primary" style="display:inline-block; text-decoration:none;">Go home</a>
  </div>
</body>
</html>`;
}

module.exports = {
  renderNotFoundHtml,
};

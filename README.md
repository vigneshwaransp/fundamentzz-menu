# Digital Menu (டிஜிட்டல் மெனு)

A production-ready, owner-only web application where restaurant owners upload a menu archive and instantly receive an unguessable public shareable link and custom QR code for their customers.

Built with **Node.js 20+**, **Express 5**, and vanilla HTML/CSS/JS with **zero frontend build steps**.

---

## Highlights & Features

- **No Frontend Build Steps**: Pure semantic HTML, responsive CSS, and native JavaScript.
- **Self-Hosted Tamil & Latin Typography**: Zero Google Fonts requests. Uses `@fontsource` packages with a custom `fonts.css` supporting Unicode ranges for Tamil (`Noto Serif Tamil`, `Hind Madurai`) and Latin (`Fraunces Variable`, `Hind Madurai`).
- **Signature Visual Design**:
  - Deep banana-leaf green (`#0e2a1c`) and card surfaces (`#133424`).
  - Rice-flour ivory (`#f4efe2`) text and surfaces.
  - Turmeric gold (`#e8b13a`) single accent.
  - Chilli (`#e0614b`) for sold-out dishes and destructive actions.
  - Faint pulli kolam dot-grid background.
  - Hero row of overlapping circular dish plates with turmeric rings (the staggered drop-in of these plates is the only page-load animation).
- **Fast Image Pipeline**:
  - Uses `sharp` with auto-orientation.
  - Generates a 1000px-wide WebP image and a 520x520 cover-cropped square WebP thumbnail.
  - 4-way concurrency worker pool.
  - Versioned image directories (`img/<version>/`) with automatic cleanup of obsolete assets.
- **Robust Multi-Format Parsing**:
  - **ZIP Archives**: Inspects entries in memory (capped at 3000 entries and 300 MB uncompressed; no disk extraction to eliminate zip-slip vulnerabilities). Automatically matches images by basename.
  - **Fundamentzz Export JSON**: Maps `selling_price` to `price`, hides `"portion"` unit, retains specific units (e.g. `"2 pcs"`, `"1 cup"`), and filters out empty categories.
  - **Generic JSON**: Supports categorized `{ categories: [...] }` or flat `{ items: [...] }` schemas.
  - **CSV**: Full RFC-4180 parser supporting quotes, commas, and line breaks within fields.
- **Enterprise-Grade Security & RBAC**:
  - Roles & Permissions: `owner` (`menus:read`, `menus:write`, `account:write`).
  - First-run seeding of owner account (generates secure password if none provided).
  - HMAC-SHA256 signed session tokens in `HttpOnly`, `SameSite=Strict` cookies (valid for 7 days).
  - Changing the password increments `passwordVersion` and immediately invalidates all previous sessions.
  - CSRF Protection: All non-GET `/api` endpoints require `X-Requested-With: dm`.
  - Rate limiting on login: 8 failed attempts per IP per 10 minutes.
  - Constant-time comparison & dummy bcrypt hash for nonexistent accounts to prevent timing attacks.
  - Security headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow` on admin.
  - Path traversal defense: strict filename regex on media routes and atomic filesystem writes.

---

## Quick Start

### 1. Requirements
- Node.js 20+ (Node 22 recommended)
- npm 10+

### 2. Install Dependencies
```bash
npm install
```

### 3. Extract Self-Hosted Fonts & Generate Samples (One-time)
```bash
npm run setup:fonts
npm run sample:data
```

### 4. Run the Server
```bash
npm start
```
The server will start on port `3000` (or `PORT` environment variable).
- **Public URL**: `http://localhost:3000`
- **Owner Admin Dashboard**: `http://localhost:3000/admin`

On initial launch, if `OWNER_PASSWORD` is not defined in the environment, a secure password is generated and printed once to the console.

---

## Configuration

Configure the application using environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP port to listen on |
| `DATA_DIR` | `./data` | Filesystem storage path for `users.json`, `secret.key`, and `menus/` |
| `PUBLIC_URL` | `http://localhost:${PORT}` | Public canonical base URL (used for QR codes and Open Graph tags) |
| `OWNER_EMAIL` | `owner@fundamentzz.local` | Email address for initial owner seed |
| `OWNER_PASSWORD` | *(Generated on first run)* | Initial password for the owner account |

---

## Storage Architecture

All data is stored directly on the filesystem under `DATA_DIR`:

```
DATA_DIR/
├── users.json                   # Atomic JSON storing users & password versions
├── secret.key                   # 64-byte random HMAC secret key
└── menus/
    └── <menuId>/
        ├── menu.json            # Atomic JSON storing categories, items, and slug
        └── img/
            └── <version>/       # Versioned directory for optimized WebP assets
                ├── <itemId>.webp
                └── <itemId>-thumb.webp
```

Every write uses an atomic rename mechanism (`write to temp file in same directory -> atomic rename`) to prevent partial or corrupted reads.

---

## Testing & Verification

Run the automated test suites:

### 1. Backend & Security Suite
Verifies RBAC, CSRF enforcement, bcrypt timing protections, Fundamentzz ZIP parsing, CSV parsing, image versioning, atomic replacement, hide/preview modes, link rotation, and path-traversal prevention:
```bash
npm test
```

### 2. Browser & Visual Verification (Playwright)
Executes end-to-end tests in headless Chrome/Chromium, testing desktop and mobile (390px) viewports, verifying square thumbnails, circular hero plates, dialog lightbox interaction, Tamil search, and zero console errors:
```bash
npm run test:browser
```
Screenshots are automatically saved to `screenshots/`:
- `screenshots/desktop-public-menu.png`
- `screenshots/desktop-admin.png`
- `screenshots/desktop-admin-detail.png`
- `screenshots/mobile-public-menu.png`
- `screenshots/mobile-admin.png`

---

## Deployment to Render

The repository includes a ready-to-deploy `render.yaml` configuration and a `Dockerfile`.

### Option A: Deploy via Blueprint (`render.yaml`)
1. Push this repository to your GitHub or GitLab account.
2. In the [Render Dashboard](https://dashboard.render.com), click **New** → **Blueprint**.
3. Connect your repository. Render will automatically configure:
   - Docker runtime (`node:22-slim`).
   - A persistent disk mounted at `/data` (1 GB) for menu and image data.
   - Environment variables (`PORT=3000`, `DATA_DIR=/data`).
4. Set `PUBLIC_URL` to your Render service URL (e.g. `https://digital-menu.onrender.com`).
5. Set `OWNER_EMAIL` and `OWNER_PASSWORD` (or let Render generate one).

### Option B: Deploy as a Docker Web Service
1. In Render, select **New** → **Web Service** → **Build and deploy from a Git repository**.
2. Environment: **Docker**.
3. Add a **Persistent Disk**:
   - Mount Path: `/data`
   - Size: 1 GB
4. Add Environment Variables:
   - `DATA_DIR`: `/data`
   - `PUBLIC_URL`: `https://<your-service-name>.onrender.com`
   - `OWNER_EMAIL`: `owner@yourdomain.com`
   - `OWNER_PASSWORD`: `<your-secure-password>`
5. Click **Create Web Service**.

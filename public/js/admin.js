// Admin SPA Client Logic

(function () {
  'use strict';

  let currentUser = null;
  let activeMenu = null;
  let isNavigating = false;

  // DOM Elements
  const appRoot = document.getElementById('app-root');
  const adminHeader = document.getElementById('admin-header');
  const userEmailDisplay = document.getElementById('user-email-display');
  const brandHomeBtn = document.getElementById('brand-home-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const openPasswordBtn = document.getElementById('open-password-btn');
  const passwordModal = document.getElementById('password-modal');
  const passwordForm = document.getElementById('password-form');
  const passwordModalCancel = document.getElementById('password-modal-cancel');
  const confirmModal = document.getElementById('confirm-modal');
  const confirmModalTitle = document.getElementById('confirm-modal-title');
  const confirmModalMessage = document.getElementById('confirm-modal-message');
  const confirmModalOk = document.getElementById('confirm-modal-ok');
  const confirmModalCancel = document.getElementById('confirm-modal-cancel');

  // ----------------------------------------------------
  // Toast Notification System
  // ----------------------------------------------------
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Deduplicate: if an identical message is already showing, pulse it instead of creating duplicates
    const existing = Array.from(container.querySelectorAll('.toast')).find(t => t.dataset.message === message);
    if (existing) {
      existing.style.animation = 'none';
      void existing.offsetHeight;
      existing.style.animation = 'toastPulse 0.3s ease';
      return;
    }

    // Limit visible toasts to at most 3
    while (container.children.length >= 3) {
      container.firstChild.remove();
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.dataset.message = message;
    
    let icon = '✓';
    if (type === 'error') icon = '✕';
    if (type === 'info') icon = 'ℹ';

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-text">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // ----------------------------------------------------
  // Modal Confirm Helper
  // ----------------------------------------------------
  let pendingConfirmResolve = null;

  function showConfirm(title, message, okText = 'Confirm') {
    return new Promise((resolve) => {
      confirmModalTitle.textContent = title;
      confirmModalMessage.textContent = message;
      confirmModalOk.textContent = okText;
      pendingConfirmResolve = resolve;
      confirmModal.showModal();
    });
  }

  confirmModalOk.addEventListener('click', () => {
    confirmModal.close();
    if (pendingConfirmResolve) pendingConfirmResolve(true);
    pendingConfirmResolve = null;
  });

  confirmModalCancel.addEventListener('click', () => {
    confirmModal.close();
    if (pendingConfirmResolve) pendingConfirmResolve(false);
    pendingConfirmResolve = null;
  });

  // ----------------------------------------------------
  // API Fetch Helper with CSRF & Error Handling
  // ----------------------------------------------------
  async function apiFetch(url, options = {}) {
    const opts = { ...options };
    opts.headers = {
      'Accept': 'application/json',
      'X-Requested-With': 'dm', // CSRF Protection Header
      ...(opts.headers || {})
    };

    if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }

    try {
      const res = await fetch(url, opts);
      
      // Handle 401 Unauthorized without infinite redirect loop
      if (res.status === 401) {
        if (!url.startsWith('/api/auth/me') && !url.startsWith('/api/auth/login')) {
          currentUser = null;
          showToast('Session expired. Please sign in.', 'error');
          navigate('#login');
        }
        return { ok: false, status: 401, error: 'Unauthorized' };
      }

      const contentType = res.headers.get('content-type') || '';
      let data = {};
      if (contentType.includes('application/json')) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = { message: text };
      }

      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: data.error || 'Request failed',
          message: data.message || `Server responded with status ${res.status}`
        };
      }

      return { ok: true, status: res.status, data };
    } catch (err) {
      return { ok: false, error: 'Network error', message: err.message };
    }
  }

  // ----------------------------------------------------
  // XHR Upload Helper (Supports Single and Chunked Uploads to bypass Vercel 4.5 MB limit)
  // ----------------------------------------------------
  function uploadSingleRequest(url, formData, onProgress) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('X-Requested-With', 'dm'); // CSRF Header
      xhr.setRequestHeader('Accept', 'application/json');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          const percent = Math.round((e.loaded / e.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        let resp = {};
        try {
          resp = JSON.parse(xhr.responseText);
        } catch (_) {
          resp = { message: xhr.responseText };
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ ok: true, data: resp });
        } else {
          resolve({
            ok: false,
            status: xhr.status,
            error: resp.error || 'Upload failed',
            message: resp.message || `Upload failed with status ${xhr.status}`
          });
        }
      };

      xhr.onerror = () => {
        resolve({ ok: false, error: 'Upload network error', message: 'Failed to communicate with server.' });
      };

      xhr.send(formData);
    });
  }

  async function apiUpload(formData, onProgress) {
    const file = formData.get('file');
    const menuId = formData.get('menuId') || '';
    const name = formData.get('name') || '';

    const CHUNK_SIZE = 3 * 1024 * 1024; // 3 MB chunks (safely below Vercel 4.5 MB gateway limit)

    // For files 3.5 MB or smaller, use standard single upload
    if (!file || file.size <= 3.5 * 1024 * 1024) {
      return uploadSingleRequest('/api/menus/upload', formData, onProgress);
    }

    // For files > 3.5 MB (e.g. 5.3 MB tamil_menu.zip), upload in sequential 3 MB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = 'upl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

    let finalResponse = null;
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(start, end);

      const chunkForm = new FormData();
      chunkForm.append('chunk', chunkBlob, file.name);
      chunkForm.append('uploadId', uploadId);
      chunkForm.append('chunkIndex', String(i));
      chunkForm.append('totalChunks', String(totalChunks));
      chunkForm.append('fileName', file.name);
      if (name) chunkForm.append('name', name);
      if (menuId) chunkForm.append('menuId', menuId);

      const progressBase = (i / totalChunks) * 100;
      const progressSpan = (1 / totalChunks) * 100;

      const chunkRes = await uploadSingleRequest('/api/menus/upload-chunk', chunkForm, (chunkPct) => {
        if (onProgress) {
          const overall = Math.min(99, Math.round(progressBase + (chunkPct / 100) * progressSpan));
          onProgress(overall);
        }
      });

      if (!chunkRes.ok) {
        return chunkRes;
      }

      finalResponse = chunkRes;
    }

    if (onProgress) onProgress(100);
    return finalResponse;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ----------------------------------------------------
  // Router & Auth Check
  // ----------------------------------------------------
  async function checkAuth() {
    const res = await apiFetch('/api/auth/me');
    if (res.ok && res.data && res.data.user) {
      currentUser = res.data.user;
      adminHeader.hidden = false;
      userEmailDisplay.textContent = currentUser.email;
      return true;
    }
    currentUser = null;
    adminHeader.hidden = true;
    return false;
  }

  function navigate(hash) {
    if (window.location.hash === hash) {
      handleRoute();
    } else {
      window.location.hash = hash;
    }
  }

  async function handleRoute() {
    if (isNavigating) return;
    isNavigating = true;

    const hash = window.location.hash || '#dashboard';

    // Verify auth status
    const isAuthed = await checkAuth();

    if (!isAuthed) {
      renderLoginView();
      isNavigating = false;
      return;
    }

    if (hash === '#login') {
      window.location.hash = '#dashboard';
      isNavigating = false;
      return;
    }

    if (hash.startsWith('#menu/')) {
      const menuId = hash.replace('#menu/', '').trim();
      await renderMenuDetailView(menuId);
    } else {
      await renderDashboardView();
    }

    isNavigating = false;
  }

  window.addEventListener('hashchange', handleRoute);

  // ----------------------------------------------------
  // View: Login
  // ----------------------------------------------------
  function renderLoginView() {
    adminHeader.hidden = true;
    appRoot.innerHTML = `
      <div class="login-view-wrap">
        <div class="login-card glass-panel">
          <div class="login-header">
            <div class="login-brand-badge" aria-hidden="true">🍃</div>
            <h1 class="login-title">Digital Menu</h1>
            <p class="login-subtitle">Restaurant Owner Sign In</p>
          </div>

          <form id="login-form">
            <div class="form-group">
              <label class="form-label" for="login-email">Email address</label>
              <input type="email" id="login-email" class="form-input" required autocomplete="username" placeholder="name@example.com">
            </div>
            <div class="form-group">
              <label class="form-label" for="login-password">Password</label>
              <input type="password" id="login-password" class="form-input" required autocomplete="current-password" placeholder="••••••••">
            </div>
            <button type="submit" class="btn btn-primary" id="login-submit-btn" style="width: 100%; margin-top: 1rem;">
              Sign in
            </button>
          </form>
        </div>
      </div>
    `;

    const form = document.getElementById('login-form');
    const submitBtn = document.getElementById('login-submit-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value.trim();
      const password = document.getElementById('login-password').value;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Signing in...';

      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });

      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in';

      if (res.ok) {
        currentUser = res.data.user;
        showToast('Signed in successfully');
        navigate('#dashboard');
      } else {
        showToast(res.message || 'Invalid email or password', 'error');
      }
    });
  }

  // ----------------------------------------------------
  // View: Dashboard
  // ----------------------------------------------------
  async function renderDashboardView() {
    appRoot.innerHTML = `
      <div>
        <div class="dashboard-heading-row">
          <h1 class="dashboard-title">My Menus</h1>
        </div>

        <!-- Drag and Drop Upload Card -->
        <div class="upload-card" id="upload-drop-zone">
          <div class="upload-icon">📂</div>
          <h2 class="upload-title">Upload a new menu</h2>
          <p class="upload-desc">Drag and drop a <strong>.zip</strong> archive, <strong>.json</strong> or <strong>.csv</strong> file up to 80 MB</p>
          
          <div class="upload-form-inputs">
            <input type="text" id="upload-name-input" class="form-input upload-name-input" placeholder="Restaurant or menu name (e.g. Banana Leaf Bhavan)">
            <input type="file" id="upload-file-input" accept=".zip,.json,.csv" hidden>
            <button type="button" class="btn btn-primary" id="select-file-btn">Choose file</button>
            <button type="button" class="btn btn-secondary" id="start-upload-btn" hidden>Upload and publish</button>
          </div>

          <div id="selected-file-label" style="margin-top: 0.8rem; font-size: 0.9rem; color: var(--color-accent);" hidden></div>

          <div class="upload-progress-wrap" id="upload-progress-wrap" hidden>
            <div class="progress-track">
              <div class="progress-fill" id="upload-progress-fill"></div>
            </div>
            <span class="progress-text" id="upload-progress-text">Uploading: 0%</span>
          </div>
        </div>

        <!-- Menus Grid -->
        <div id="menus-container">
          <p style="color: var(--color-text-muted);">Loading menus...</p>
        </div>
      </div>
    `;

    setupUploadZone();
    await loadMenusList();
  }

  function setupUploadZone() {
    const dropZone = document.getElementById('upload-drop-zone');
    const fileInput = document.getElementById('upload-file-input');
    const selectBtn = document.getElementById('select-file-btn');
    const startBtn = document.getElementById('start-upload-btn');
    const nameInput = document.getElementById('upload-name-input');
    const fileLabel = document.getElementById('selected-file-label');
    const progressWrap = document.getElementById('upload-progress-wrap');
    const progressFill = document.getElementById('upload-progress-fill');
    const progressText = document.getElementById('upload-progress-text');

    let selectedFile = null;

    selectBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        selectedFile = fileInput.files[0];
        onFileSelected();
      }
    });

    // Drag and Drop
    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.add('is-dragover');
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        dropZone.classList.remove('is-dragover');
      });
    });

    dropZone.addEventListener('drop', (e) => {
      if (e.dataTransfer.files.length > 0) {
        selectedFile = e.dataTransfer.files[0];
        onFileSelected();
      }
    });

    function onFileSelected() {
      if (!selectedFile) return;
      fileLabel.textContent = `Selected: ${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`;
      fileLabel.hidden = false;
      startBtn.hidden = false;
      selectBtn.textContent = 'Change file';

      if (!nameInput.value.trim()) {
        const base = selectedFile.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
        nameInput.value = base.charAt(0).toUpperCase() + base.slice(1);
      }
    }

    startBtn.addEventListener('click', async () => {
      if (!selectedFile) {
        showToast('Please select a file to upload', 'error');
        return;
      }

      const name = nameInput.value.trim() || 'Digital Menu';
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('name', name);

      startBtn.disabled = true;
      selectBtn.disabled = true;
      progressWrap.hidden = false;
      progressFill.style.width = '0%';
      progressText.textContent = 'Starting upload...';

      const res = await apiUpload(formData, (percent) => {
        progressFill.style.width = `${percent}%`;
        progressText.textContent = percent >= 100 ? 'Processing menu & optimizing images...' : `Uploading: ${percent}%`;
      });

      startBtn.disabled = false;
      selectBtn.disabled = false;

      if (res.ok) {
        showToast('Menu uploaded and published successfully');
        navigate(`#menu/${res.data.menu.id}`);
      } else {
        progressWrap.hidden = true;
        showToast(res.message || 'Upload failed', 'error');
      }
    });
  }

  async function loadMenusList() {
    const container = document.getElementById('menus-container');
    if (!container) return;

    const res = await apiFetch('/api/menus');
    if (!res.ok) {
      container.innerHTML = `<p style="color: var(--color-destructive);">${escapeHtml(res.message || 'Failed to load menus')}</p>`;
      return;
    }

    const menus = res.data.menus || [];
    if (menus.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding: 3rem 1rem; color: var(--color-text-muted);">
          <p style="font-size: 1.1rem; margin-bottom: 0.5rem;">No menus uploaded yet</p>
          <p style="font-size: 0.9rem;">Upload a menu archive above to get started instantly.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="menus-grid">
        ${menus.map(m => `
          <div class="menu-admin-card" data-menu-id="${escapeHtml(m.id)}">
            <div class="menu-card-cover">
              ${m.coverImage ? `
                <img src="${escapeHtml(m.coverImage)}" alt="${escapeHtml(m.name)}" loading="lazy">
              ` : `
                <div style="display:flex; align-items:center; justify-content:center; height:100%; font-size:2rem; color:var(--color-accent);" aria-hidden="true">🍃</div>
              `}
              <div class="menu-card-status-pill ${m.published ? 'status-live' : 'status-hidden'}">
                <span style="width:6px; height:6px; border-radius:50%; background-color:${m.published ? 'var(--color-accent)' : '#888'};"></span>
                <span>${m.published ? 'Live' : 'Hidden'}</span>
              </div>
            </div>
            <div class="menu-card-body">
              <h2 class="menu-card-name">${escapeHtml(m.name)}</h2>
              ${m.tagline ? `<p class="menu-card-tagline">${escapeHtml(m.tagline)}</p>` : ''}
              <div class="menu-card-meta">
                <div class="menu-card-counts">
                  <span>${m.itemCount} ${m.itemCount === 1 ? 'dish' : 'dishes'}</span> · 
                  <span>${m.categoryCount} ${m.categoryCount === 1 ? 'category' : 'categories'}</span>
                </div>
                <button type="button" class="btn-card-remove" data-menu-id="${escapeHtml(m.id)}" data-menu-name="${escapeHtml(m.name)}" title="Remove this menu">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Remove
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    Array.from(container.querySelectorAll('.menu-admin-card')).forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-menu-id');
        navigate(`#menu/${id}`);
      });
    });

    Array.from(container.querySelectorAll('.btn-card-remove')).forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-menu-id');
        const name = btn.getAttribute('data-menu-name') || 'this menu';
        const ok = await showConfirm(
          'Remove menu',
          `Are you sure you want to permanently remove "${name}"? This action cannot be undone.`,
          'Remove menu'
        );
        if (!ok) return;

        const delRes = await apiFetch(`/api/menus/${id}`, { method: 'DELETE' });
        if (delRes.ok) {
          showToast(`"${name}" has been removed`);
          await loadMenusList();
        } else {
          showToast(delRes.message || 'Failed to remove menu', 'error');
        }
      });
    });
  }

  // ----------------------------------------------------
  // View: Menu Detail
  // ----------------------------------------------------
  async function renderMenuDetailView(menuId) {
    appRoot.innerHTML = `<p style="color: var(--color-text-muted);">Loading menu details...</p>`;

    const res = await apiFetch(`/api/menus/${menuId}`);
    if (!res.ok) {
      appRoot.innerHTML = `
        <div style="padding: 2rem; text-align: center;">
          <h2 style="color: var(--color-destructive); margin-bottom: 0.5rem;">Error loading menu</h2>
          <p style="color: var(--color-text-muted); margin-bottom: 1.5rem;">${escapeHtml(res.message || 'Menu not found')}</p>
          <button type="button" class="btn btn-secondary" id="back-to-dash-err">Back to Dashboard</button>
        </div>
      `;
      document.getElementById('back-to-dash-err')?.addEventListener('click', () => navigate('#dashboard'));
      return;
    }

    activeMenu = res.data.menu;
    const menu = activeMenu;

    appRoot.innerHTML = `
      <div>
        <div class="detail-top-nav">
          <button type="button" class="btn btn-secondary btn-sm" id="detail-back-btn">
            ← All menus
          </button>
          <div style="display: flex; gap: 0.5rem;">
            <button type="button" class="btn btn-destructive btn-sm" id="detail-delete-btn">
              Delete menu
            </button>
          </div>
        </div>

        <div class="detail-layout">
          <!-- Left Column: Share Panel & Replace File -->
          <aside>
            <!-- Share Panel -->
            <div class="detail-panel">
              <h2 class="panel-title">Share menu</h2>
              
              <div class="share-link-group">
                <input type="text" id="share-link-input" class="form-input share-link-input" readonly value="${escapeHtml(menu.publicUrl)}">
                <button type="button" class="btn btn-secondary btn-sm" id="copy-link-btn">Copy</button>
              </div>

              <div class="share-actions-row">
                <button type="button" class="btn btn-secondary btn-sm" id="open-menu-btn">Open menu ↗</button>
                <a href="/api/menus/${escapeHtml(menu.id)}/qr.svg?download=1" class="btn btn-secondary btn-sm" id="download-qr-btn">Download QR</a>
                <button type="button" class="btn ${menu.published ? 'btn-secondary' : 'btn-primary'} btn-sm" id="toggle-publish-btn">
                  ${menu.published ? 'Hide' : 'Publish'}
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="rotate-link-btn">New link</button>
              </div>

              <div class="qr-preview-box" id="qr-preview-box">
                <p style="font-size: 0.85rem; color: #0e2a1c;">Loading QR...</p>
              </div>
            </div>

            <!-- Customization Feature (Logo, Colors, Fonts, Slider Toggle) -->
            <div class="detail-panel" id="customization-panel">
              <h2 class="panel-title">🎨 Branding & Customization</h2>

              <!-- Slider to turn ON / OFF -->
              <div class="customization-toggle-row">
                <div class="customization-toggle-info">
                  <span class="customization-toggle-title">
                    Custom Theme & Logo
                  </span>
                  <span class="customization-toggle-desc" id="cust-toggle-desc">
                    ${(menu.customization && menu.customization.enabled) ? 'Custom branding, colors, and typography active' : 'Using default emerald theme (turn on to enable custom colors & logo)'}
                  </span>
                </div>
                <label class="switch-toggle" title="Turn Customization ON or OFF">
                  <input type="checkbox" id="cust-enabled-switch" ${(menu.customization && menu.customization.enabled) ? 'checked' : ''}>
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="customization-controls ${(menu.customization && menu.customization.enabled) ? '' : 'is-disabled'}" id="cust-controls-wrap">
                <!-- Restaurant Logo -->
                <div class="cust-section-title">
                  <span>Restaurant Logo</span>
                </div>
                <div class="cust-logo-box">
                  <div class="cust-logo-preview" id="cust-logo-preview">
                    ${(menu.customization && menu.customization.logo) ? `
                      <img src="${escapeHtml(menu.customization.logo)}" alt="Logo" id="cust-logo-img">
                    ` : `
                      <div class="cust-logo-placeholder">No logo<br>uploaded</div>
                    `}
                  </div>
                  <div class="cust-logo-controls">
                    <input type="file" id="cust-logo-file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
                    <div class="cust-logo-btns">
                      <button type="button" class="btn btn-secondary btn-sm" id="cust-logo-upload-btn">
                        ${(menu.customization && menu.customization.logo) ? 'Change logo' : 'Upload logo'}
                      </button>
                      <button type="button" class="btn btn-destructive btn-sm" id="cust-logo-remove-btn" ${(menu.customization && menu.customization.logo) ? '' : 'hidden'}>
                        Remove logo
                      </button>
                    </div>
                    <span style="font-size: 0.76rem; color: var(--color-text-muted);">
                      PNG, WebP, JPG, or SVG
                    </span>
                  </div>
                </div>

                <!-- Color Theme -->
                <div class="cust-section-title">
                  <span>Color Theme</span>
                </div>
                <div class="cust-themes-grid" id="cust-themes-grid"></div>

                <!-- Custom Color Pickers -->
                <div class="cust-colors-row">
                  <div class="color-picker-item">
                    <label for="cust-primary-color">Primary Accent</label>
                    <div class="color-input-wrap">
                      <input type="color" id="cust-primary-color" class="color-input-circle" value="${escapeHtml(menu.customization?.primaryColor || '#059669')}">
                      <span class="color-hex-tag" id="cust-primary-hex">${escapeHtml(menu.customization?.primaryColor || '#059669')}</span>
                    </div>
                  </div>
                  <div class="color-picker-item">
                    <label for="cust-glow-color">Background Glow</label>
                    <div class="color-input-wrap">
                      <input type="color" id="cust-glow-color" class="color-input-circle" value="${escapeHtml(menu.customization?.bgGlowColor ? (menu.customization.bgGlowColor.startsWith('#') ? menu.customization.bgGlowColor : '#10b981') : '#10b981')}">
                      <span class="color-hex-tag" id="cust-glow-hex">${escapeHtml(menu.customization?.bgGlowColor ? (menu.customization.bgGlowColor.startsWith('#') ? menu.customization.bgGlowColor : '#10b981') : '#10b981')}</span>
                    </div>
                  </div>
                </div>

                <!-- Font Styles -->
                <div class="cust-section-title">
                  <span>Typography</span>
                </div>
                <div class="cust-fonts-grid" id="cust-fonts-grid">
                  <div class="font-option-card ${(menu.customization?.fontFamily === 'serif' || !menu.customization?.fontFamily) ? 'is-active' : ''}" data-font="serif">
                    <span class="font-card-label">Heritage Serif</span>
                    <span class="font-card-sub">Playfair Display · Elegant</span>
                    <div class="font-card-sample font-sample-serif">Gourmet Dosa · ₹180</div>
                  </div>
                  <div class="font-option-card ${menu.customization?.fontFamily === 'sans' ? 'is-active' : ''}" data-font="sans">
                    <span class="font-card-label">Modern Clean</span>
                    <span class="font-card-sub">Poppins · Crisp & Rounded</span>
                    <div class="font-card-sample font-sample-sans">Crispy Vada · ₹80</div>
                  </div>
                  <div class="font-option-card ${menu.customization?.fontFamily === 'display' ? 'is-active' : ''}" data-font="display">
                    <span class="font-card-label">Luxury Display</span>
                    <span class="font-card-sub">Cinzel · Fine Dining</span>
                    <div class="font-card-sample font-sample-display">FILTER COFFEE</div>
                  </div>
                  <div class="font-option-card ${menu.customization?.fontFamily === 'geometric' ? 'is-active' : ''}" data-font="geometric">
                    <span class="font-card-label">Contemporary</span>
                    <span class="font-card-sub">Plus Jakarta · Minimalist</span>
                    <div class="font-card-sample font-sample-geometric">Signature Thali · ₹240</div>
                  </div>
                </div>

                <!-- Save & Preview -->
                <div class="cust-save-bar">
                  <button type="button" class="btn btn-primary btn-sm" id="save-customization-btn">
                    Save customization
                  </button>
                  <button type="button" class="btn btn-secondary btn-sm" id="preview-customization-btn">
                    Preview menu ↗
                  </button>
                </div>
              </div>
            </div>

            <!-- Replace Menu File -->
            <div class="detail-panel">
              <h2 class="panel-title">Replace menu file</h2>
              <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 1rem;">
                Re-upload an archive or data file. Dishes and photos will update while keeping this exact same link and QR code!
              </p>

              <input type="file" id="replace-file-input" accept=".zip,.json,.csv" hidden>
              <button type="button" class="btn btn-secondary btn-sm" id="replace-select-btn">Select replacement file</button>
              <div id="replace-file-label" style="font-size: 0.82rem; color: var(--color-accent); margin-top: 0.5rem;" hidden></div>
              <button type="button" class="btn btn-primary btn-sm" id="replace-start-btn" style="margin-top: 0.75rem;" hidden>Upload & replace</button>

              <div class="upload-progress-wrap" id="replace-progress-wrap" hidden>
                <div class="progress-track">
                  <div class="progress-fill" id="replace-progress-fill"></div>
                </div>
                <span class="progress-text" id="replace-progress-text">0%</span>
              </div>
            </div>

            <!-- Restaurant Details Form -->
            <div class="detail-panel">
              <h2 class="panel-title">Restaurant details</h2>
              <form id="details-form">
                <div class="form-group">
                  <label class="form-label" for="detail-name">Restaurant name</label>
                  <input type="text" id="detail-name" class="form-input" required value="${escapeHtml(menu.name)}">
                </div>
                <div class="form-group">
                  <label class="form-label" for="detail-tagline">Tagline</label>
                  <input type="text" id="detail-tagline" class="form-input" value="${escapeHtml(menu.tagline || '')}">
                </div>
                <div class="form-group">
                  <label class="form-label" for="detail-address">Address</label>
                  <input type="text" id="detail-address" class="form-input" value="${escapeHtml(menu.address || '')}">
                </div>
                <div class="form-group">
                  <label class="form-label" for="detail-phone">Phone number</label>
                  <input type="text" id="detail-phone" class="form-input" value="${escapeHtml(menu.phone || '')}">
                </div>
                <div class="form-group">
                  <label class="form-label" for="detail-currency">Currency</label>
                  <select id="detail-currency" class="form-select">
                    <option value="INR" ${menu.currency === 'INR' ? 'selected' : ''}>INR (₹ - Indian Rupee)</option>
                    <option value="USD" ${menu.currency === 'USD' ? 'selected' : ''}>USD ($ - US Dollar)</option>
                    <option value="SGD" ${menu.currency === 'SGD' ? 'selected' : ''}>SGD ($ - Singapore Dollar)</option>
                    <option value="MYR" ${menu.currency === 'MYR' ? 'selected' : ''}>MYR (RM - Malaysian Ringgit)</option>
                    <option value="EUR" ${menu.currency === 'EUR' ? 'selected' : ''}>EUR (€ - Euro)</option>
                    <option value="GBP" ${menu.currency === 'GBP' ? 'selected' : ''}>GBP (£ - British Pound)</option>
                    <option value="AED" ${menu.currency === 'AED' ? 'selected' : ''}>AED (AED - UAE Dirham)</option>
                  </select>
                </div>
                <div class="form-group">
                  <label class="form-label" for="detail-footnote">Bottom note / footnote</label>
                  <textarea id="detail-footnote" class="form-textarea">${escapeHtml(menu.footnote || '')}</textarea>
                </div>
                <button type="submit" class="btn btn-primary btn-sm" id="save-details-btn">Save details</button>
              </form>
            </div>
          </aside>

          <!-- Right Column: Dish Editor -->
          <section>
            <div class="detail-panel">
              <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 1.25rem;">
                <h2 class="panel-title" style="margin-bottom:0; border:none;">Dishes & categories</h2>
                <span style="font-size: 0.85rem; color: var(--color-text-muted);">${menu.items?.length || 0} total dishes</span>
              </div>

              <div id="dish-editor-container">
                <!-- Injected dish categories -->
              </div>
            </div>
          </section>
        </div>
      </div>
    `;

    document.getElementById('detail-back-btn').addEventListener('click', () => navigate('#dashboard'));

    // Load QR SVG Preview
    loadQrPreview(menu.id);

    // Setup share panel actions
    setupSharePanel(menu);

    // Setup customization feature (logo, colors, fonts, slider)
    setupCustomizationPanel(menu);

    // Setup replace file upload
    setupReplaceUpload(menu);

    // Setup details form
    setupDetailsForm(menu);

    // Setup dish editor
    renderDishEditor(menu);

    // Setup delete menu
    document.getElementById('detail-delete-btn').addEventListener('click', async () => {
      const ok = await showConfirm(
        'Delete menu',
        `Are you sure you want to permanently delete "${menu.name}"? This action cannot be undone.`,
        'Delete menu'
      );
      if (!ok) return;

      const res = await apiFetch(`/api/menus/${menu.id}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Menu deleted');
        navigate('#dashboard');
      } else {
        showToast(res.message || 'Failed to delete menu', 'error');
      }
    });
  }

  async function loadQrPreview(menuId) {
    const box = document.getElementById('qr-preview-box');
    if (!box) return;

    try {
      const res = await fetch(`/api/menus/${menuId}/qr.svg`, {
        headers: { 'X-Requested-With': 'dm' }
      });
      if (res.ok) {
        const svg = await res.text();
        box.innerHTML = svg;
      } else {
        box.innerHTML = '<span style="color:#666; font-size:0.8rem;">Could not load QR</span>';
      }
    } catch (_) {
      box.innerHTML = '<span style="color:#666; font-size:0.8rem;">QR preview error</span>';
    }
  }

  function setupSharePanel(menu) {
    const copyBtn = document.getElementById('copy-link-btn');
    const linkInput = document.getElementById('share-link-input');
    const openBtn = document.getElementById('open-menu-btn');
    const togglePublishBtn = document.getElementById('toggle-publish-btn');
    const rotateLinkBtn = document.getElementById('rotate-link-btn');

    copyBtn.addEventListener('click', () => {
      linkInput.select();
      navigator.clipboard.writeText(linkInput.value).then(() => {
        showToast('Link copied to clipboard');
      }).catch(() => {
        document.execCommand('copy');
        showToast('Link copied');
      });
    });

    openBtn.addEventListener('click', () => {
      window.open(menu.publicUrl, '_blank');
    });

    // Toggle Hide/Publish
    togglePublishBtn.addEventListener('click', async () => {
      const newStatus = !menu.published;
      const res = await apiFetch(`/api/menus/${menu.id}`, {
        method: 'PATCH',
        body: { published: newStatus }
      });

      if (res.ok) {
        menu.published = newStatus;
        togglePublishBtn.textContent = newStatus ? 'Hide' : 'Publish';
        togglePublishBtn.className = `btn ${newStatus ? 'btn-secondary' : 'btn-primary'} btn-sm`;
        // Consistent label feedback
        showToast(newStatus ? 'Published' : 'Hidden');
      } else {
        showToast(res.message || 'Failed to update visibility', 'error');
      }
    });

    // Rotate Link
    rotateLinkBtn.addEventListener('click', async () => {
      const ok = await showConfirm(
        'Generate new link',
        'Rotate the public link? The existing link and QR code will immediately become invalid (404) and cannot be restored.',
        'Generate new link'
      );
      if (!ok) return;

      const res = await apiFetch(`/api/menus/${menu.id}/rotate-link`, {
        method: 'POST'
      });

      if (res.ok) {
        menu.slug = res.data.newSlug;
        menu.publicUrl = res.data.publicUrl;
        linkInput.value = menu.publicUrl;
        loadQrPreview(menu.id);
        showToast('Link rotated');
      } else {
        showToast(res.message || 'Failed to rotate link', 'error');
      }
    });
  }

  function setupReplaceUpload(menu) {
    const fileInput = document.getElementById('replace-file-input');
    const selectBtn = document.getElementById('replace-select-btn');
    const startBtn = document.getElementById('replace-start-btn');
    const label = document.getElementById('replace-file-label');
    const progressWrap = document.getElementById('replace-progress-wrap');
    const progressFill = document.getElementById('replace-progress-fill');
    const progressText = document.getElementById('replace-progress-text');

    let replaceFile = null;

    selectBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
      if (fileInput.files.length > 0) {
        replaceFile = fileInput.files[0];
        label.textContent = `Selected: ${replaceFile.name} (${Math.round(replaceFile.size / 1024)} KB)`;
        label.hidden = false;
        startBtn.hidden = false;
      }
    });

    startBtn.addEventListener('click', async () => {
      if (!replaceFile) return;

      const formData = new FormData();
      formData.append('file', replaceFile);
      formData.append('menuId', menu.id);
      formData.append('name', menu.name);

      startBtn.disabled = true;
      selectBtn.disabled = true;
      progressWrap.hidden = false;
      progressFill.style.width = '0%';
      progressText.textContent = 'Uploading...';

      const res = await apiUpload(formData, (percent) => {
        progressFill.style.width = `${percent}%`;
        progressText.textContent = percent >= 100 ? 'Replacing dishes & images...' : `Uploading: ${percent}%`;
      });

      startBtn.disabled = false;
      selectBtn.disabled = false;

      if (res.ok) {
        showToast('Menu content replaced successfully');
        await renderMenuDetailView(menu.id);
      } else {
        progressWrap.hidden = true;
        showToast(res.message || 'Failed to replace menu', 'error');
      }
    });
  }

  function setupDetailsForm(menu) {
    const form = document.getElementById('details-form');
    const saveBtn = document.getElementById('save-details-btn');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const payload = {
        name: document.getElementById('detail-name').value.trim(),
        tagline: document.getElementById('detail-tagline').value.trim(),
        address: document.getElementById('detail-address').value.trim(),
        phone: document.getElementById('detail-phone').value.trim(),
        currency: document.getElementById('detail-currency').value,
        footnote: document.getElementById('detail-footnote').value.trim()
      };

      const res = await apiFetch(`/api/menus/${menu.id}`, {
        method: 'PATCH',
        body: payload
      });

      saveBtn.disabled = false;
      saveBtn.textContent = 'Save details';

      if (res.ok) {
        Object.assign(menu, res.data.menu);
        showToast('Saved');
      } else {
        showToast(res.message || 'Failed to save details', 'error');
      }
    });
  }

  function setupCustomizationPanel(menu) {
    const cust = menu.customization || {};
    let isEnabled = Boolean(cust.enabled);
    let selectedTheme = cust.theme || 'emerald';
    let selectedFont = cust.fontFamily || 'serif';

    const THEME_PALETTES = [
      { id: 'emerald', name: 'Emerald', primary: '#059669', glow: '#10b981' },
      { id: 'sapphire', name: 'Sapphire', primary: '#2563eb', glow: '#3b82f6' },
      { id: 'ruby', name: 'Ruby', primary: '#e11d48', glow: '#f43f5e' },
      { id: 'amber', name: 'Amber', primary: '#d97706', glow: '#f59e0b' },
      { id: 'amethyst', name: 'Amethyst', primary: '#7c3aed', glow: '#8b5cf6' },
      { id: 'obsidian', name: 'Obsidian', primary: '#0f172a', glow: '#64748b' },
      { id: 'terracotta', name: 'Terracotta', primary: '#ea580c', glow: '#f97316' },
    ];

    const toggleSwitch = document.getElementById('cust-enabled-switch');
    const toggleDesc = document.getElementById('cust-toggle-desc');
    const controlsWrap = document.getElementById('cust-controls-wrap');

    const logoInput = document.getElementById('cust-logo-file-input');
    const uploadLogoBtn = document.getElementById('cust-logo-upload-btn');
    const removeLogoBtn = document.getElementById('cust-logo-remove-btn');
    const logoPreviewBox = document.getElementById('cust-logo-preview');

    const themesGrid = document.getElementById('cust-themes-grid');
    const primaryInput = document.getElementById('cust-primary-color');
    const primaryHex = document.getElementById('cust-primary-hex');
    const glowInput = document.getElementById('cust-glow-color');
    const glowHex = document.getElementById('cust-glow-hex');

    const fontsGrid = document.getElementById('cust-fonts-grid');
    const saveBtn = document.getElementById('save-customization-btn');
    const previewBtn = document.getElementById('preview-customization-btn');

    if (!toggleSwitch || !controlsWrap) return;

    // 1. Slider toggle switch
    toggleSwitch.addEventListener('change', () => {
      isEnabled = toggleSwitch.checked;
      if (isEnabled) {
        controlsWrap.classList.remove('is-disabled');
        toggleDesc.textContent = 'Custom branding, colors, and typography active';
      } else {
        controlsWrap.classList.add('is-disabled');
        toggleDesc.textContent = 'Using default emerald theme (turn on to enable custom colors & logo)';
      }
    });

    // 2. Logo Upload & Remove
    uploadLogoBtn?.addEventListener('click', () => {
      logoInput.click();
    });

    logoInput?.addEventListener('change', async () => {
      if (!logoInput.files || logoInput.files.length === 0) return;
      const file = logoInput.files[0];
      if (file.size > 5 * 1024 * 1024) {
        showToast('Logo image must be under 5 MB', 'error');
        return;
      }

      uploadLogoBtn.disabled = true;
      uploadLogoBtn.textContent = 'Uploading...';

      const formData = new FormData();
      formData.append('logo', file);

      try {
        const res = await uploadSingleRequest(`/api/menus/${menu.id}/logo`, formData);
        if (res.ok) {
          const logoUri = res.data.logo;
          menu.customization = res.data.customization || menu.customization || {};
          menu.customization.logo = logoUri;

          logoPreviewBox.innerHTML = `<img src="${escapeHtml(logoUri)}" alt="Logo" id="cust-logo-img">`;
          removeLogoBtn.hidden = false;
          uploadLogoBtn.textContent = 'Change logo';
          showToast('Restaurant logo uploaded successfully');
        } else {
          showToast(res.message || 'Failed to upload logo', 'error');
        }
      } catch (err) {
        showToast(err.message || 'Error uploading logo', 'error');
      } finally {
        uploadLogoBtn.disabled = false;
        uploadLogoBtn.textContent = (menu.customization && menu.customization.logo) ? 'Change logo' : 'Upload logo';
        logoInput.value = '';
      }
    });

    removeLogoBtn?.addEventListener('click', async () => {
      const ok = await showConfirm(
        'Remove logo',
        'Are you sure you want to remove the restaurant logo?',
        'Remove'
      );
      if (!ok) return;

      removeLogoBtn.disabled = true;
      const res = await apiFetch(`/api/menus/${menu.id}/logo`, { method: 'DELETE' });
      removeLogoBtn.disabled = false;

      if (res.ok) {
        if (menu.customization) menu.customization.logo = null;
        logoPreviewBox.innerHTML = `<div class="cust-logo-placeholder">No logo<br>uploaded</div>`;
        removeLogoBtn.hidden = true;
        uploadLogoBtn.textContent = 'Upload logo';
        showToast('Restaurant logo removed');
      } else {
        showToast(res.message || 'Failed to remove logo', 'error');
      }
    });

    // 3. Theme Palettes
    if (themesGrid) {
      themesGrid.innerHTML = THEME_PALETTES.map(p => {
        const isActive = selectedTheme === p.id;
        return `
          <div class="theme-chip ${isActive ? 'is-active' : ''}" data-theme-id="${p.id}" style="--chip-primary: ${p.primary}">
            <span class="theme-swatch" style="background: ${p.primary};"></span>
            <span class="theme-chip-name">${escapeHtml(p.name)}</span>
          </div>
        `;
      }).join('');

      themesGrid.querySelectorAll('.theme-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const themeId = chip.getAttribute('data-theme-id');
          selectedTheme = themeId;

          themesGrid.querySelectorAll('.theme-chip').forEach(c => c.classList.remove('is-active'));
          chip.classList.add('is-active');

          const palette = THEME_PALETTES.find(p => p.id === themeId);
          if (palette) {
            primaryInput.value = palette.primary;
            primaryHex.textContent = palette.primary;
            glowInput.value = palette.glow;
            glowHex.textContent = palette.glow;
          }

          if (!toggleSwitch.checked) {
            toggleSwitch.checked = true;
            controlsWrap.classList.remove('is-disabled');
            toggleDesc.textContent = 'Custom branding, colors, and typography active';
          }
        });
      });
    }

    // Custom Color input listeners
    primaryInput?.addEventListener('input', () => {
      primaryHex.textContent = primaryInput.value;
      selectedTheme = 'custom';
      themesGrid?.querySelectorAll('.theme-chip').forEach(c => c.classList.remove('is-active'));
      if (!toggleSwitch.checked) {
        toggleSwitch.checked = true;
        controlsWrap.classList.remove('is-disabled');
        toggleDesc.textContent = 'Custom branding, colors, and typography active';
      }
    });

    glowInput?.addEventListener('input', () => {
      glowHex.textContent = glowInput.value;
      selectedTheme = 'custom';
      themesGrid?.querySelectorAll('.theme-chip').forEach(c => c.classList.remove('is-active'));
      if (!toggleSwitch.checked) {
        toggleSwitch.checked = true;
        controlsWrap.classList.remove('is-disabled');
        toggleDesc.textContent = 'Custom branding, colors, and typography active';
      }
    });

    // 4. Font Option Cards
    fontsGrid?.querySelectorAll('.font-option-card').forEach(card => {
      card.addEventListener('click', () => {
        const fontKey = card.getAttribute('data-font');
        selectedFont = fontKey;

        fontsGrid.querySelectorAll('.font-option-card').forEach(c => c.classList.remove('is-active'));
        card.classList.add('is-active');

        if (!toggleSwitch.checked) {
          toggleSwitch.checked = true;
          controlsWrap.classList.remove('is-disabled');
          toggleDesc.textContent = 'Custom branding, colors, and typography active';
        }
      });
    });

    // 5. Save Customization
    saveBtn?.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      const payload = {
        customization: {
          enabled: toggleSwitch.checked,
          logo: (menu.customization && menu.customization.logo) || null,
          theme: selectedTheme,
          primaryColor: primaryInput.value,
          secondaryColor: primaryInput.value,
          bgGlowColor: glowInput.value,
          fontFamily: selectedFont
        }
      };

      const res = await apiFetch(`/api/menus/${menu.id}`, {
        method: 'PATCH',
        body: payload
      });

      saveBtn.disabled = false;
      saveBtn.textContent = 'Save customization';

      if (res.ok) {
        menu.customization = res.data.menu.customization;
        showToast('Customization and typography saved successfully!');
      } else {
        showToast(res.message || 'Failed to save customization', 'error');
      }
    });

    // 6. Preview Menu in new tab
    previewBtn?.addEventListener('click', () => {
      window.open(menu.publicUrl, '_blank');
    });
  }

  function renderDishEditor(menu) {
    const container = document.getElementById('dish-editor-container');
    if (!container) return;

    const categories = menu.categories || [];
    const items = menu.items || [];

    if (categories.length === 0 && items.length === 0) {
      container.innerHTML = '<p style="color:var(--color-text-muted);">No categories or dishes found.</p>';
      return;
    }

    container.innerHTML = categories.map(cat => {
      const catItems = items.filter(it => it.categoryId === cat.id);
      return `
        <div class="dish-category-group" data-cat-id="${escapeHtml(cat.id)}">
          <div class="dish-cat-header">
            <input type="text"
                   class="dish-cat-input"
                   value="${escapeHtml(cat.name)}"
                   data-cat-id="${escapeHtml(cat.id)}"
                   title="Click to rename category">
            <span style="font-size: 0.8rem; color: var(--color-text-muted);">${catItems.length} items</span>
          </div>

          <div class="dish-editor-list">
            ${catItems.map(dish => {
              const dishThumb = dish.thumbData || (dish.image && menu.imageVersion ? `/media/${menu.slug}/${menu.imageVersion}/${dish.id}-thumb.webp` : '');
              return `
              <div class="dish-editor-row" data-dish-id="${escapeHtml(dish.id)}">
                <div style="display:flex; align-items:center; gap:0.65rem;">
                  ${dishThumb ? `
                    <img src="${escapeHtml(dishThumb)}"
                         alt=""
                         style="width:42px; height:42px; border-radius:8px; object-fit:cover; border:1px solid rgba(15,23,42,0.1); flex-shrink:0;">
                  ` : `
                    <div style="width:42px; height:42px; border-radius:8px; background:rgba(5,150,105,0.08); color:var(--color-accent); display:flex; align-items:center; justify-content:center; font-weight:600; font-size:1.1rem; flex-shrink:0;">
                      ${escapeHtml((dish.name || 'D').trim().charAt(0).toUpperCase())}
                    </div>
                  `}
                  <div style="flex:1; min-width:0;">
                    <input type="text"
                           class="dish-field-input dish-name-input"
                           value="${escapeHtml(dish.name)}"
                           placeholder="Dish name"
                           style="width: 100%; margin-bottom: 0.35rem;"
                           data-dish-id="${escapeHtml(dish.id)}">
                    <input type="text"
                           class="dish-field-input dish-desc-input"
                           value="${escapeHtml(dish.description || '')}"
                           placeholder="Description (optional)"
                           style="width: 100%; font-size: 0.82rem; color: var(--color-text-muted);"
                           data-dish-id="${escapeHtml(dish.id)}">
                  </div>
                </div>

                <div>
                  <input type="number"
                         step="any"
                         min="0"
                         class="dish-field-input dish-price-input"
                         value="${dish.price}"
                         placeholder="Price"
                         style="width: 100%;"
                         data-dish-id="${escapeHtml(dish.id)}">
                </div>

                <div>
                  <input type="text"
                         class="dish-field-input dish-unit-input"
                         value="${escapeHtml(dish.unit || '')}"
                         placeholder="Unit"
                         style="width: 100%; font-size: 0.82rem;"
                         data-dish-id="${escapeHtml(dish.id)}">
                </div>

                <div>
                  <label class="dish-available-label">
                    <input type="checkbox"
                           class="dish-available-checkbox"
                           ${dish.available ? 'checked' : ''}
                           data-dish-id="${escapeHtml(dish.id)}">
                    <span>Available</span>
                  </label>
                </div>

                <div style="text-align: right;">
                  <button type="button"
                          class="btn btn-destructive btn-sm dish-delete-btn"
                          data-dish-id="${escapeHtml(dish.id)}"
                          title="Delete dish"
                          aria-label="Delete dish">
                    ✕
                  </button>
                </div>
              </div>
            `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Inline category name edit on change
    Array.from(container.querySelectorAll('.dish-cat-input')).forEach(input => {
      input.addEventListener('change', async () => {
        const catId = input.getAttribute('data-cat-id');
        const newName = input.value.trim();
        if (!newName) return;

        const res = await apiFetch(`/api/menus/${menu.id}/categories/${catId}`, {
          method: 'PATCH',
          body: { name: newName }
        });

        if (res.ok) {
          const cat = menu.categories?.find(c => c.id === catId);
          if (cat) cat.name = newName;
          showToast('Category updated');
        } else {
          showToast(res.message || 'Failed to update category', 'error');
        }
      });
    });

    // Inline dish field edit (name, description, price, unit) on change
    Array.from(container.querySelectorAll('.dish-editor-row')).forEach(row => {
      const dishId = row.getAttribute('data-dish-id');
      const nameInput = row.querySelector('.dish-name-input');
      const descInput = row.querySelector('.dish-desc-input');
      const priceInput = row.querySelector('.dish-price-input');
      const unitInput = row.querySelector('.dish-unit-input');
      const availCheckbox = row.querySelector('.dish-available-checkbox');
      const deleteBtn = row.querySelector('.dish-delete-btn');

      const saveItem = async () => {
        const payload = {
          name: nameInput.value.trim(),
          description: descInput.value.trim(),
          price: parseFloat(priceInput.value) || 0,
          unit: unitInput.value.trim(),
          available: availCheckbox.checked
        };

        const res = await apiFetch(`/api/menus/${menu.id}/items/${dishId}`, {
          method: 'PATCH',
          body: payload
        });

        if (res.ok) {
          const item = menu.items?.find(it => it.id === dishId);
          if (item) Object.assign(item, payload);
          showToast('Dish updated');
        } else {
          showToast(res.message || 'Failed to update dish', 'error');
        }
      };

      [nameInput, descInput, priceInput, unitInput].forEach(inp => {
        inp.addEventListener('change', saveItem);
      });

      availCheckbox.addEventListener('change', saveItem);

      deleteBtn.addEventListener('click', async () => {
        const ok = await showConfirm(
          'Delete dish',
          `Are you sure you want to remove "${nameInput.value}" from the menu?`,
          'Delete'
        );
        if (!ok) return;

        const res = await apiFetch(`/api/menus/${menu.id}/items/${dishId}`, {
          method: 'DELETE'
        });

        if (res.ok) {
          menu.items = menu.items?.filter(it => it.id !== dishId);
          row.remove();
          showToast('Dish removed');
        } else {
          showToast(res.message || 'Failed to delete dish', 'error');
        }
      });
    });
  }

  // ----------------------------------------------------
  // Global Header Actions (Brand, Password, Logout)
  // ----------------------------------------------------
  brandHomeBtn.addEventListener('click', () => navigate('#dashboard'));

  logoutBtn.addEventListener('click', async () => {
    const res = await apiFetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    showToast('Logged out');
    navigate('#login');
  });

  openPasswordBtn.addEventListener('click', () => {
    passwordForm.reset();
    passwordModal.showModal();
  });

  passwordModalCancel.addEventListener('click', () => {
    passwordModal.close();
  });

  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const oldPassword = document.getElementById('old-password-input').value;
    const newPassword = document.getElementById('new-password-input').value;

    const res = await apiFetch('/api/auth/password', {
      method: 'POST',
      body: { oldPassword, newPassword }
    });

    if (res.ok) {
      passwordModal.close();
      showToast('Password updated');
    } else {
      showToast(res.message || 'Failed to change password', 'error');
    }
  });

  // Initial Route Load
  handleRoute();
})();

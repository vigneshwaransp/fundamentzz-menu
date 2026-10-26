document.addEventListener('DOMContentLoaded', () => {
  // 1. Live Search
  const searchInput = document.getElementById('dish-search');
  const searchClearBtn = document.getElementById('search-clear-btn');
  const emptyState = document.getElementById('empty-search-state');
  const resetSearchBtn = document.getElementById('reset-search-btn');
  const dishCards = Array.from(document.querySelectorAll('.dish-card'));
  const categorySections = Array.from(document.querySelectorAll('.menu-category-section'));

  function doSearch() {
    const rawQuery = (searchInput.value || '').trim();
    const query = rawQuery.toLowerCase();

    if (rawQuery.length > 0) {
      searchClearBtn.hidden = false;
    } else {
      searchClearBtn.hidden = true;
    }

    let totalVisible = 0;

    categorySections.forEach(section => {
      const cards = Array.from(section.querySelectorAll('.dish-card'));
      let sectionVisibleCount = 0;

      cards.forEach(card => {
        const text = (card.getAttribute('data-search-text') || '').toLowerCase();
        // Substring search works across Tamil and Latin characters cleanly
        const matches = query === '' || text.includes(query);
        if (matches) {
          card.hidden = false;
          sectionVisibleCount++;
          totalVisible++;
        } else {
          card.hidden = true;
        }
      });

      // Hide category header if 0 cards match in this section
      section.hidden = sectionVisibleCount === 0;
    });

    if (totalVisible === 0) {
      emptyState.hidden = false;
    } else {
      emptyState.hidden = true;
    }
  }

  if (searchInput) {
    searchInput.addEventListener('input', doSearch);
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      searchInput.value = '';
      doSearch();
      searchInput.focus();
    });
  }

  if (resetSearchBtn) {
    resetSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      doSearch();
      searchInput.focus();
    });
  }

  // 2. Sticky Category Chips with IntersectionObserver
  const chips = Array.from(document.querySelectorAll('.category-chip'));
  const scroller = document.getElementById('categories-scroller');

  if ('IntersectionObserver' in window && categorySections.length > 0) {
    let activeId = null;

    const observer = new IntersectionObserver((entries) => {
      // Find sections currently intersecting
      const visible = entries.filter(e => e.isIntersecting);
      if (visible.length > 0) {
        // Pick the top visible section
        const topEntry = visible.reduce((prev, curr) => {
          return curr.boundingClientRect.top < prev.boundingClientRect.top ? curr : prev;
        });

        const catId = topEntry.target.getAttribute('data-cat-id');
        if (catId && catId !== activeId) {
          activeId = catId;
          updateActiveChip(catId);
        }
      }
    }, {
      rootMargin: '-80px 0px -60% 0px',
      threshold: [0, 0.2, 0.5]
    });

    categorySections.forEach(sec => observer.observe(sec));

    function updateActiveChip(catId) {
      chips.forEach(chip => {
        const isMatch = chip.getAttribute('href') === `#cat-${catId}`;
        chip.classList.toggle('is-active', isMatch);
        chip.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        if (isMatch && scroller) {
          // Scroll chip horizontally into view smoothly
          const scrollerRect = scroller.getBoundingClientRect();
          const chipRect = chip.getBoundingClientRect();
          if (chipRect.left < scrollerRect.left || chipRect.right > scrollerRect.right) {
            chip.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }
        }
      });
    }
  }

  // 3. Dish Lightbox Dialog
  const dialog = document.getElementById('dish-dialog');
  const dialogCloseBtn = document.getElementById('dialog-close-btn');
  const dialogImgWrap = document.getElementById('dialog-img-wrap');
  const dialogImg = document.getElementById('dialog-img');
  const dialogName = document.getElementById('dialog-dish-name');
  const dialogPrice = document.getElementById('dialog-dish-price');
  const dialogDesc = document.getElementById('dialog-dish-desc');

  function openDishDialog(card) {
    if (!dialog) return;
    const name = card.getAttribute('data-dish-name') || '';
    const price = card.getAttribute('data-dish-price') || '';
    const desc = card.getAttribute('data-dish-desc') || '';
    const imgSrc = card.getAttribute('data-dish-image') || '';

    dialogName.textContent = name;
    dialogPrice.textContent = price;
    dialogDesc.textContent = desc;

    if (imgSrc) {
      dialogImg.src = imgSrc;
      dialogImg.alt = name;
      dialogImgWrap.hidden = false;
    } else {
      dialogImg.src = '';
      dialogImgWrap.hidden = true;
    }

    dialog.showModal();
  }

  function closeDishDialog() {
    if (dialog && dialog.open) {
      dialog.close();
    }
  }

  dishCards.forEach(card => {
    card.addEventListener('click', () => openDishDialog(card));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDishDialog(card);
      }
    });
  });

  if (dialogCloseBtn) {
    dialogCloseBtn.addEventListener('click', closeDishDialog);
  }

  if (dialog) {
    // Close on clicking backdrop
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!inDialog) {
        closeDishDialog();
      }
    });
  }
});

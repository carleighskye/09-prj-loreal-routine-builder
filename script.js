/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsListContainer = document.getElementById("selectedProductsList");
const generateRoutineBtn = document.getElementById("generateRoutine");

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Create HTML for displaying product cards */
// Render product cards. Each card includes data-id and data-name for selection.
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map((product, index) => {
      const id = product.id || product.sku || `${product.name}-${index}`;
      const safeId = String(id).replace(/"/g, "&quot;");
      const safeName = (product.name || "Product").replace(/"/g, "&quot;");
      const safeDescription = (product.description || "").replace(/"/g, "&quot;");
      const safeBrand = (product.brand || "").replace(/"/g, "&quot;");

      return `
    <div class="product-card" data-id="${safeId}" data-name="${safeName}" role="button" tabindex="0">
      <img src="${product.image}" alt="${safeName}">
      <div class="product-info">
        <h3>${safeName}</h3>
        <p>${product.brand || ''}</p>
      </div>
      <div class="product-actions">
        <button class="details-btn" data-id="${safeId}" data-name="${safeName}" data-description="${safeDescription}" data-brand="${safeBrand}">Details</button>
      </div>
    </div>
  `;
    })
    .join("");

  // Attach selection handlers to the newly created cards
  initCardSelectionHandlers();
  // Attach details handlers for the Details button (if present)
  initDetailsHandlers();
}

/* Selection state: Map<id, {id, name}> */
const selectedProducts = new Map();

function initCardSelectionHandlers() {
  const cards = productsContainer.querySelectorAll('.product-card');
  cards.forEach((card) => {
    // Click toggles selection
    card.addEventListener('click', () => toggleCardSelection(card));

    // Keyboard accessibility
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleCardSelection(card);
      }
    });
  });
}

function initDetailsHandlers() {
  // If cards include a details button, wiring is done here. We also support delegation via dataset attributes.
  const detailBtns = productsContainer.querySelectorAll('.details-btn');
  detailBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name') || '';
      const desc = btn.getAttribute('data-description') || '';
      const brand = btn.getAttribute('data-brand') || '';
      openProductModal({ id, name, description: desc, brand });
    });
  });
}

/* Modal handling */
const productModal = document.getElementById('productModal');
const modalTitle = document.getElementById('modalTitle');
const modalDescription = document.getElementById('modalDescription');
const modalMeta = document.getElementById('modalMeta');
const modalCloseBtn = productModal ? productModal.querySelector('.modal-close') : null;
let lastFocusedElement = null;

function openProductModal(product) {
  if (!productModal) return;
  lastFocusedElement = document.activeElement;
  modalTitle.textContent = product.name || 'Product';
  modalDescription.textContent = product.description || 'No description available.';
  modalMeta.textContent = product.brand ? `Brand: ${product.brand}` : '';

  productModal.classList.add('show');
  productModal.setAttribute('aria-hidden', 'false');

  // focus the close button for easier keyboard navigation
  if (modalCloseBtn) modalCloseBtn.focus();
}

function closeProductModal() {
  if (!productModal) return;
  productModal.classList.remove('show');
  productModal.setAttribute('aria-hidden', 'true');

  // return focus
  if (lastFocusedElement) lastFocusedElement.focus();
}

// Close modal from close button
if (modalCloseBtn) {
  modalCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeProductModal();
  });
}

// Close when clicking backdrop
if (productModal) {
  productModal.addEventListener('click', (e) => {
    // if clicked directly on backdrop (not the modal content), close
    if (e.target === productModal || e.target.classList.contains('modal-backdrop')) {
      closeProductModal();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && productModal.classList.contains('show')) {
      closeProductModal();
    }
  });
}

function toggleCardSelection(card) {
  const id = card.getAttribute('data-id');
  const name = card.getAttribute('data-name') || card.querySelector('h3')?.textContent || 'Product';

  if (selectedProducts.has(id)) {
    // unselect
    selectedProducts.delete(id);
    card.classList.remove('selected');
  } else {
    selectedProducts.set(id, { id, name });
    card.classList.add('selected');
  }

  renderSelectedProductsList();
}

function renderSelectedProductsList() {
  if (!selectedProductsListContainer) return;
  selectedProductsListContainer.innerHTML = '';

  if (selectedProducts.size === 0) {
    selectedProductsListContainer.innerHTML = '<div class="placeholder-message">No products selected</div>';
    return;
  }

  selectedProducts.forEach((product) => {
    const item = document.createElement('div');
    item.className = 'selected-item';
    item.setAttribute('data-id', product.id);

    const label = document.createElement('div');
    label.textContent = product.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('data-id', product.id);
    removeBtn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      unselectById(id);
    });

    item.appendChild(label);
    item.appendChild(removeBtn);
    selectedProductsListContainer.appendChild(item);
  });
}

function unselectById(id) {
  if (!selectedProducts.has(id)) return;
  selectedProducts.delete(id);

  // Remove visual mark from card if present
  const card = productsContainer.querySelector(`.product-card[data-id="${id}"]`);
  if (card) card.classList.remove('selected');

  renderSelectedProductsList();
}

/* Filter and display products when category changes */
categoryFilter.addEventListener("change", async (e) => {
  const products = await loadProducts();
  const selectedCategory = e.target.value;

  /* filter() creates a new array containing only products 
     where the category matches what the user selected */
  const filteredProducts = products.filter(
    (product) => product.category === selectedCategory
  );

  displayProducts(filteredProducts);
});

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  chatWindow.innerHTML = "Connect to the OpenAI API for a response!";
});

// Optional: generateRoutine button can read selected products
if (generateRoutineBtn) {
  generateRoutineBtn.addEventListener('click', () => {
    const selected = Array.from(selectedProducts.values());
    if (selected.length === 0) {
      alert('Please select one or more products first.');
      return;
    }

    // For now, just show a quick message. Integration with routine builder goes here.
    alert(`Generating routine for ${selected.length} product(s):\n- ${selected.map(p => p.name).join('\n- ')}`);
  });
}

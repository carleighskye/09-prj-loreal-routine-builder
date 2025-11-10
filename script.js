/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productsContainer = document.getElementById("productsContainer");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const selectedProductsListContainer = document.getElementById(
  "selectedProductsList"
);
const generateRoutineBtn = document.getElementById("generateRoutine");
const restartChatBtn = document.getElementById("restartChat");
const productSearch = document.getElementById("productSearch");

// simple in-memory cache for products to avoid repeated fetches
let _productsCache = null;

// Set this to your deployed Cloudflare Worker URL, e.g.
// const WORKER_URL = 'https://lorealbot.carleigh-skye.workers.dev/';
// Leave empty to keep the current placeholder behaviour.
const WORKER_URL = "https://lorealbot.carleigh-skye.workers.dev/";

// System-level instruction: restrict the assistant to the site's product catalogue.
// NOTE: We accept any product that appears in `products.json` regardless of brand.
const LOREAL_ONLY_SYSTEM_MESSAGE = {
  role: "system",
  content:
    "You are an expert assistant that provides information only about products listed in the site's product catalogue. If a product is present in the catalogue, provide factual information and include it when generating routines, even if the brand is not L'Oréal. If the user asks about products not in the catalogue, politely refuse and offer alternatives from the catalogue. Keep answers factual, concise, and do not invent products outside the provided list.",
};

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Select a category to view products
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  if (_productsCache) return _productsCache;
  const response = await fetch("products.json");
  const data = await response.json();
  _productsCache = data.products || [];
  return _productsCache;
}

// Populate the category dropdown from the products catalogue to avoid mismatches
async function populateCategoryFilter() {
  try {
    const products = await loadProducts();
    const cats = Array.from(
      new Set(
        products.map((p) => String(p.category || "").trim()).filter(Boolean)
      )
    );
    // preserve order, but sort alphabetically for usability
    cats.sort((a, b) => a.localeCompare(b));
    // Build options as actual elements so option.value remains the raw category string
    if (!categoryFilter) return;
    categoryFilter.innerHTML = "";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.disabled = true;
    defaultOpt.selected = true;
    defaultOpt.textContent = "Choose a Category";
    categoryFilter.appendChild(defaultOpt);

    cats.forEach((c) => {
      const opt = document.createElement("option");
      const val = String(c).trim();
      opt.value = val;
      opt.textContent = val.charAt(0).toUpperCase() + val.slice(1);
      categoryFilter.appendChild(opt);
    });
    console.debug("populateCategoryFilter categories:", cats);
  } catch (e) {
    console.warn("populateCategoryFilter failed", e);
  }
}

// NOTE: wiring for the Clear Selections button is done after the
// `clearSelectionsBtn` variable is declared further down to avoid a
// ReferenceError (accessing a `const` before declaration would throw
// and stop script execution, preventing the category filter from working).

// Initialize persisted state
(async function initPersistedState() {
  await populateCategoryFilter();
  await loadSelectedFromLocalStorage();
  loadConversation();
  renderChatHistory();
})();

// Build and cache a system message that lists allowed products (name, brand, category, description)
let _productsSystemMessage = null;
async function getProductsSystemMessage() {
  if (_productsSystemMessage) return _productsSystemMessage;
  try {
    const products = await loadProducts();
    // only include a compact set of fields to keep the prompt concise
    const allowed = products.map((p) => ({
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description,
    }));

    _productsSystemMessage = {
      role: "system",
      content:
        "Only use and discuss products from the following catalogue. Do not mention, recommend, compare, or provide instructions for any product not in this list. If asked about a product outside this list, politely refuse and offer an alternative from the list. The catalogue (JSON): " +
        JSON.stringify(allowed),
    };

    return _productsSystemMessage;
  } catch (err) {
    // fallback: return a conservative system message
    return {
      role: "system",
      content:
        "You may only discuss products listed on this site. If the product is not in the site's catalogue, refuse and offer L'Oréal alternatives.",
    };
  }
}

/* Create HTML for displaying product cards */
// Render product cards. Each card includes data-id and data-name for selection.
function displayProducts(products) {
  productsContainer.innerHTML = products
    .map((product, index) => {
      const id = product.id || product.sku || `${product.name}-${index}`;
      const safeId = String(id).replace(/"/g, "&quot;");
      const safeName = (product.name || "Product").replace(/"/g, "&quot;");
      const safeDescription = (product.description || "").replace(
        /"/g,
        "&quot;"
      );
      const safeBrand = (product.brand || "").replace(/"/g, "&quot;");
      const safeCategory = (product.category || "").replace(/"/g, "&quot;");

      return `
    <div class="product-card" data-id="${safeId}" data-name="${safeName}" data-brand="${safeBrand}" data-category="${safeCategory}" data-description="${safeDescription}" role="button" tabindex="0">
      <img src="${product.image}" alt="${safeName}">
      <div class="product-info">
        <h3>${safeName}</h3>
        <p>${product.brand || ""}</p>
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

const clearSelectionsBtn = document.getElementById("clearSelections");

// Wire the Clear Selections button here (after the element is looked up)
if (clearSelectionsBtn) {
  clearSelectionsBtn.addEventListener("click", () => {
    if (!confirm("Clear all selected products?")) return;
    clearAllSelections();
  });
}

// Persist selected product ids to localStorage
const SELECTED_STORAGE_KEY = "selected_products_v1";
const CHAT_HISTORY_KEY = "chat_history_v1";
let conversationMessages = [];

function saveSelectedToLocalStorage() {
  try {
    const ids = Array.from(selectedProducts.keys());
    localStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(ids));
  } catch (e) {
    console.warn("saveSelectedToLocalStorage failed", e);
  }
}

async function loadSelectedFromLocalStorage() {
  try {
    const raw = localStorage.getItem(SELECTED_STORAGE_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return;
    const all = await loadProducts();
    ids.forEach((id) => {
      const p = all.find(
        (x) => String(x.id) === String(id) || String(x.sku) === String(id)
      );
      if (p)
        selectedProducts.set(String(p.id), {
          id: String(p.id),
          name: p.name,
          brand: p.brand,
          category: p.category,
          description: p.description,
        });
    });
    renderSelectedProductsList();
  } catch (e) {
    console.warn("loadSelectedFromLocalStorage failed", e);
  }
}

function clearAllSelections() {
  selectedProducts.clear();
  document
    .querySelectorAll(".product-card.selected")
    .forEach((c) => c.classList.remove("selected"));
  saveSelectedToLocalStorage();
  saveSelectedToLocalStorage();
  renderSelectedProductsList();
  saveSelectedToLocalStorage();
}

function saveConversation() {
  try {
    localStorage.setItem(
      CHAT_HISTORY_KEY,
      JSON.stringify(conversationMessages)
    );
  } catch (e) {
    console.warn("saveConversation failed", e);
  }
}

// Restart chat: clear conversationMessages and persisted chat history
if (restartChatBtn) {
  restartChatBtn.addEventListener("click", () => {
    if (!confirm("Restart chat? This will clear the conversation history."))
      return;

    // Clear in-memory conversation and persisted storage
    conversationMessages = [];
    try {
      localStorage.removeItem(CHAT_HISTORY_KEY);
    } catch (e) {
      console.warn("Failed to remove chat history", e);
    }

    // Reset chat window UI
    if (chatWindow) {
      chatWindow.innerHTML =
        '<div class="placeholder-message">Chat restarted. Ask me about products or routines…</div>';
      chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    // Persist the cleared state
    saveConversation();

    // Focus the input field for convenience
    const input = document.getElementById("userInput");
    if (input) {
      input.value = "";
      input.focus();
    }
  });
}

function loadConversation() {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    if (raw) conversationMessages = JSON.parse(raw);
  } catch (e) {
    console.warn("loadConversation failed", e);
  }
}

function renderChatHistory() {
  if (!conversationMessages || conversationMessages.length === 0) return;
  chatWindow.innerHTML = "";
  conversationMessages.forEach((m) => {
    if (m.role === "assistant")
      chatWindow.innerHTML += renderAIContentToHTML(m.content);
    else if (m.role === "user")
      chatWindow.innerHTML += `<div class="user-message">${escapeHtml(
        m.content
      )}</div>`;
  });
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function markSelectedCards() {
  document.querySelectorAll(".product-card").forEach((card) => {
    const id = card.getAttribute("data-id");
    if (selectedProducts.has(String(id))) card.classList.add("selected");
  });
}

function initCardSelectionHandlers() {
  const cards = productsContainer.querySelectorAll(".product-card");
  cards.forEach((card) => {
    // Click toggles selection
    card.addEventListener("click", () => toggleCardSelection(card));

    // Keyboard accessibility
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleCardSelection(card);
      }
    });
  });
  // mark persisted selections visually
  markSelectedCards();
}

function initDetailsHandlers() {
  // If cards include a details button, wiring is done here. We also support delegation via dataset attributes.
  const detailBtns = productsContainer.querySelectorAll(".details-btn");
  detailBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.getAttribute("data-id");
      const name = btn.getAttribute("data-name") || "";
      const desc = btn.getAttribute("data-description") || "";
      const brand = btn.getAttribute("data-brand") || "";
      openProductModal({ id, name, description: desc, brand });
    });
  });
}

/* Modal handling */
const productModal = document.getElementById("productModal");
const modalTitle = document.getElementById("modalTitle");
const modalDescription = document.getElementById("modalDescription");
const modalMeta = document.getElementById("modalMeta");
const modalCloseBtn = productModal
  ? productModal.querySelector(".modal-close")
  : null;
let lastFocusedElement = null;

function openProductModal(product) {
  if (!productModal) return;
  lastFocusedElement = document.activeElement;
  modalTitle.textContent = product.name || "Product";
  modalDescription.textContent =
    product.description || "No description available.";
  modalMeta.textContent = product.brand ? `Brand: ${product.brand}` : "";

  productModal.classList.add("show");
  productModal.setAttribute("aria-hidden", "false");

  // focus the close button for easier keyboard navigation
  if (modalCloseBtn) modalCloseBtn.focus();
}

function closeProductModal() {
  if (!productModal) return;
  productModal.classList.remove("show");
  productModal.setAttribute("aria-hidden", "true");

  // return focus
  if (lastFocusedElement) lastFocusedElement.focus();
}

// Close modal from close button
if (modalCloseBtn) {
  modalCloseBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeProductModal();
  });
}

// Close when clicking backdrop
if (productModal) {
  productModal.addEventListener("click", (e) => {
    // if clicked directly on backdrop (not the modal content), close
    if (
      e.target === productModal ||
      e.target.classList.contains("modal-backdrop")
    ) {
      closeProductModal();
    }
  });

  // Close on Escape
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && productModal.classList.contains("show")) {
      closeProductModal();
    }
  });
}

function toggleCardSelection(card) {
  const id = card.getAttribute("data-id");
  const name =
    card.getAttribute("data-name") ||
    card.querySelector("h3")?.textContent ||
    "Product";

  if (selectedProducts.has(id)) {
    // unselect
    selectedProducts.delete(id);
    card.classList.remove("selected");
  } else {
    // capture additional metadata for the routine generation
    const brand =
      card.getAttribute("data-brand") ||
      card.querySelector("p")?.textContent ||
      "";
    const category = card.getAttribute("data-category") || "";
    const description = card.getAttribute("data-description") || "";

    selectedProducts.set(id, { id, name, brand, category, description });
    card.classList.add("selected");
  }

  renderSelectedProductsList();
  // persist selection changes so they survive page reloads
  saveSelectedToLocalStorage();
}

function renderSelectedProductsList() {
  if (!selectedProductsListContainer) return;
  selectedProductsListContainer.innerHTML = "";

  if (selectedProducts.size === 0) {
    selectedProductsListContainer.innerHTML =
      '<div class="placeholder-message">No products selected</div>';
    return;
  }

  selectedProducts.forEach((product) => {
    const item = document.createElement("div");
    item.className = "selected-item";
    item.setAttribute("data-id", product.id);

    const label = document.createElement("div");
    label.textContent = product.name;

    const removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.textContent = "Remove";
    removeBtn.setAttribute("data-id", product.id);
    removeBtn.addEventListener("click", (e) => {
      const id = e.currentTarget.getAttribute("data-id");
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
  const card = productsContainer.querySelector(
    `.product-card[data-id="${id}"]`
  );
  if (card) card.classList.remove("selected");

  renderSelectedProductsList();
  // persist after removal
  saveSelectedToLocalStorage();
}

/* Combined filter: category + search. Shows placeholder if no filters are active. */
function debounce(fn, wait = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

async function filterAndDisplayProducts() {
  try {
    const products = await loadProducts();

    const selectedCategory = categoryFilter
      ? String(categoryFilter.value || "")
          .trim()
          .toLowerCase()
      : "";
    const query = productSearch
      ? String(productSearch.value || "")
          .trim()
          .toLowerCase()
      : "";

    // If no category selected and no search query, show initial placeholder
    if (!selectedCategory && !query) {
      productsContainer.innerHTML = `
        <div class="placeholder-message">Select a category to view products</div>
      `;
      return;
    }

    let filtered = products.slice();

    if (selectedCategory) {
      filtered = filtered.filter(
        (p) =>
          String(p.category || "")
            .trim()
            .toLowerCase() === selectedCategory
      );
    }

    if (query) {
      filtered = filtered.filter((p) => {
        const name = String(p.name || "").toLowerCase();
        const brand = String(p.brand || "").toLowerCase();
        const desc = String(p.description || "").toLowerCase();
        return (
          name.includes(query) || brand.includes(query) || desc.includes(query)
        );
      });
    }

    if (!filtered || filtered.length === 0) {
      const label = selectedCategory || query || "";
      productsContainer.innerHTML = `
        <div class="placeholder-message">No products found for "${escapeHtml(
          label
        )}".</div>
      `;
      return;
    }

    displayProducts(filtered);
  } catch (err) {
    console.warn("filterAndDisplayProducts failed", err);
    productsContainer.innerHTML = `<div class="placeholder-message">Could not load products.</div>`;
  }
}

// wire events: category change + search input (debounced)
if (categoryFilter) {
  categoryFilter.addEventListener("change", () => filterAndDisplayProducts());
}
if (productSearch) {
  productSearch.addEventListener(
    "input",
    debounce(() => filterAndDisplayProducts(), 180)
  );
}

/* Chat form submission handler - placeholder for OpenAI integration */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const input = document.getElementById("userInput");
  const userText = input?.value?.trim();
  if (!userText) return;

  // Basic UI feedback
  chatWindow.innerHTML =
    '<div class="placeholder-message">Waiting for response...</div>';

  // Build messages: product catalogue system message, L'Oréal-only policy, then the conversation
  const productsSystem = await getProductsSystemMessage();

  // add user's message to conversation history and persist
  conversationMessages.push({ role: "user", content: userText });
  saveConversation();

  const messages = [
    productsSystem,
    LOREAL_ONLY_SYSTEM_MESSAGE,
    ...conversationMessages,
  ];

  // If worker is configured, send to worker so API key stays secret
  if (WORKER_URL) {
    try {
      const data = await sendToWorker({ messages });
      const content =
        data?.choices?.[0]?.message?.content || JSON.stringify(data);

      // push assistant reply into conversation history and persist
      conversationMessages.push({ role: "assistant", content });
      saveConversation();

      renderChatHistory();
    } catch (err) {
      chatWindow.innerHTML = `<div class="placeholder-message">Error: ${
        err.message || err
      }</div>`;
    } finally {
      if (input) input.value = "";
    }
  } else {
    // Fallback placeholder behavior
    chatWindow.innerHTML = "Connect to the OpenAI API for a response!";
    if (input) input.value = "";
  }
});

async function sendToWorker(payload) {
  const resp = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const text = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = text;
    }
    throw new Error(parsed?.error || resp.statusText || JSON.stringify(parsed));
  }

  // Try to parse JSON, otherwise return raw text
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return await resp.json();
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    return { text };
  }
}

// Helper to escape HTML and preserve line breaks for safe display
function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return "";
  const str = String(unsafe);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderAIContentToHTML(content) {
  // remove markdown headings (#) and bullet markers (*) and numbered lists
  function cleanMarkdown(s) {
    return String(s)
      .replace(/^#+\s*/gm, "")
      .replace(/^\s*[\*\-]\s*/gm, "")
      .replace(/^\s*\d+\.\s*/gm, "");
  }

  if (typeof content !== "string") {
    try {
      content = JSON.stringify(content, null, 2);
    } catch (e) {
      content = String(content);
    }
  }
  // clean markdown characters then escape
  content = cleanMarkdown(content);
  // remove inline markdown emphasis markers like *bold* or _italic_
  content = content.replace(/\*(.*?)\*/g, "$1");
  // remove any remaining stray asterisks
  content = content.replace(/\*/g, "");
  const escaped = escapeHtml(content);
  // preserve paragraphs / line breaks
  const withBreaks = escaped.replace(/\r\n|\r|\n/g, "<br>");
  return `<div class="ai-response">${withBreaks}</div>`;
}

// Suggest products for missing steps: scan the content for category keywords and
// recommend a product from the full catalogue if none of the selected products match that category.
async function suggestMissingProducts(content, selected) {
  const products = await loadProducts();
  const selectedCategories = new Set(
    (selected || []).map((s) => (s.category || "").toLowerCase())
  );
  // Map keywords (that may appear in an AI routine step) to sensible catalogue categories.
  // Values are arrays of one or more category strings as used in products.json.
  const keywordToCategories = {
    // skincare-specific
    cleanser: ["cleanser"],
    "face wash": ["cleanser"],
    micellar: ["cleanser"],
    moisturizer: ["moisturizer"],
    moisturize: ["moisturizer"],
    lotion: ["moisturizer"],
    cream: ["moisturizer"],
    serum: ["skincare"],
    "vitamin c": ["skincare"],
    retinol: ["skincare"],
    niacinamide: ["skincare"],
    sunscreen: ["suncare", "skincare"],
    spf: ["suncare", "skincare"],
    toner: ["skincare"],
    exfoliant: ["skincare"],
    scrub: ["skincare"],
    peel: ["skincare"],
    mask: ["skincare"],
    eye: ["skincare"],
    "eye cream": ["skincare"],
    treatment: ["skincare", "moisturizer"],

    // haircare
    shampoo: ["haircare"],
    conditioner: ["haircare"],
    hair: ["haircare", "hair styling", "hair color"],
    scalp: ["haircare"],
    hairspray: ["hair styling"],
    styling: ["hair styling"],
    "hair mask": ["haircare"],
    "hair color": ["hair color"],

    // makeup
    mascara: ["makeup"],
    foundation: ["makeup"],
    lipstick: ["makeup"],
    eyeshadow: ["makeup"],
    makeup: ["makeup"],

    // other
    fragrance: ["fragrance"],
    perfume: ["fragrance"],
    shave: ["men's grooming", "skincare"],
    "after shave": ["men's grooming"],
  };

  const lc = (content || "").toLowerCase();
  const foundCategories = new Map(); // Map<category, matchedKeywords[]>

  // Detect which keyword groups appear in the content and collect their target categories
  for (const [kw, cats] of Object.entries(keywordToCategories)) {
    if (lc.includes(kw)) {
      cats.forEach((cat) => {
        const key = String(cat).toLowerCase();
        if (!foundCategories.has(key)) foundCategories.set(key, new Set());
        foundCategories.get(key).add(kw);
      });
    }
  }

  const suggestions = [];

  // For each detected target category, if the user hasn't selected a product in that category,
  // choose a relevant product from the catalogue.
  // Determine high-level groups (skincare, makeup, haircare, fragrance, men) for categories
  const categoryToGroup = (cat) => {
    const c = String(cat || "").toLowerCase();
    if (!c) return "other";
    if (
      c.includes("makeup") ||
      c === "makeup" ||
      c === "mascara" ||
      c === "foundation"
    )
      return "makeup";
    if (c.includes("hair")) return "haircare";
    if (c === "fragrance" || c === "perfume") return "fragrance";
    if (c === "men's grooming") return "mens";
    if (
      [
        "cleanser",
        "moisturizer",
        "skincare",
        "suncare",
        "toner",
        "exfoliant",
        "mask",
        "serum",
        "treatment",
        "eye",
      ].includes(c)
    )
      return "skincare";
    return "other";
  };

  // Derive preferred groups from selected products (if any) or from detected keywords in the content
  const selectedGroups = new Set(
    Array.from(selected || []).map((s) => categoryToGroup(s.category))
  );

  // Count detected group mentions in content (based on foundCategories)
  const detectedGroupCounts = {};
  for (const cat of foundCategories.keys()) {
    const g = categoryToGroup(cat);
    detectedGroupCounts[g] =
      (detectedGroupCounts[g] || 0) + (foundCategories.get(cat)?.size || 1);
  }

  // Decide allowed groups: if user has selected products, prefer those groups; otherwise pick the top detected group(s)
  let allowedGroups = new Set();
  if (
    selectedGroups.size > 0 &&
    !(selectedGroups.size === 1 && selectedGroups.has("other"))
  ) {
    // use groups from selection (e.g., user selected mostly skincare products)
    selectedGroups.forEach((g) => allowedGroups.add(g));
  } else {
    // pick the group(s) with highest counts from detected keywords
    const entries = Object.entries(detectedGroupCounts).sort(
      (a, b) => b[1] - a[1]
    );
    if (entries.length > 0) {
      // allow the top group; if there's a close second, allow it too
      const top = entries[0][0];
      allowedGroups.add(top);
      if (
        entries.length > 1 &&
        entries[1][1] >= Math.max(1, entries[0][1] - 1)
      ) {
        allowedGroups.add(entries[1][0]);
      }
    }
  }

  // If we couldn't detect any group, allow all groups (fallback)
  const allowAll = allowedGroups.size === 0;

  for (const [targetCat, kws] of foundCategories.entries()) {
    if (selectedCategories.has(targetCat)) continue; // already satisfied by user's selection

    // Prefer exact category matches; be lenient with casing and whitespace
    const candidate = findBestCandidate(products, targetCat, Array.from(kws));
    if (!candidate) continue;

    // Only include suggestions whose group is allowed (so skincare routines won't get makeup suggestions)
    const candGroup = categoryToGroup(candidate.category);
    if (allowAll || allowedGroups.has(candGroup)) {
      suggestions.push({ category: targetCat, product: candidate });
    }
  }

  return suggestions;

  // helper: find the best product matching one of the target categories
  function findBestCandidate(productsList, targetCategory, matchedKeywords) {
    const tc = String(targetCategory).toLowerCase();

    // 1) exact category match and also match one of the keywords in name/description
    let candidate = productsList.find(
      (p) =>
        (p.category || "").toLowerCase() === tc &&
        matchedKeywords.some(
          (k) =>
            (p.name || "").toLowerCase().includes(k) ||
            (p.description || "").toLowerCase().includes(k)
        )
    );
    if (candidate) return candidate;

    // 2) any product with exact category
    candidate = productsList.find(
      (p) => (p.category || "").toLowerCase() === tc
    );
    if (candidate) return candidate;

    // 3) fallback: if targetCategory contains 'hair' prefer any product whose category includes 'hair'
    if (tc.includes("hair")) {
      candidate = productsList.find((p) =>
        (p.category || "").toLowerCase().includes("hair")
      );
      if (candidate) return candidate;
    }

    // 4) last resort: try to match by keyword in name/description across all products
    for (const k of matchedKeywords) {
      candidate = productsList.find(
        (p) =>
          (p.name || "").toLowerCase().includes(k) ||
          (p.description || "").toLowerCase().includes(k)
      );
      if (candidate) return candidate;
    }

    return null;
  }
}

// Generate Routine: collect selected products and ask OpenAI to build a routine
if (generateRoutineBtn) {
  generateRoutineBtn.addEventListener("click", async () => {
    const selected = Array.from(selectedProducts.values());
    if (selected.length === 0) {
      alert("Please select one or more products first.");
      return;
    }

    // include products catalogue system message to restrict model to allowed products
    const productsSystem = await getProductsSystemMessage();

    const systemMessage = {
      role: "system",
      content:
        "You are a helpful beauty assistant. Given a list of selected products (each with id, brand, name, category, description, image), produce a clear step-by-step routine that uses only the selected products. For each step include: the product name (from the provided data), when to use it (AM/PM), the order, short instructions for application, and a one-sentence rationale. If a routine step requires a product category that is not present in the selected products, indicate that the user has not selected a product for that step (do not invent products).",
    };

    // Lookup full product objects from the catalogue so the model has complete product info
    const allProducts = await loadProducts();
    const selectedFull = selected.map((s) => {
      // try to match by numeric id first, then by name
      const byId = allProducts.find((p) => String(p.id) === String(s.id));
      if (byId) return byId;
      const byName = allProducts.find(
        (p) => (p.name || "").toLowerCase() === (s.name || "").toLowerCase()
      );
      return byName || s; // fallback to whatever metadata we have
    });

    const userMessage = {
      role: "user",
      content: `Generate a routine using ONLY the selected products below. Use the provided product fields when referencing products. Selected products (JSON):\n${JSON.stringify(
        selectedFull,
        null,
        2
      )}\nRespond in plain text, do not recommend products not in this list.`,
    };

    // Include the L'Oréal-only system message first to enforce product scope
    // Add a brief, user-friendly record to the conversation history so follow-ups remain in context.
    // IMPORTANT: do NOT store the full JSON payload (userMessage.content) in conversationMessages
    // because that would render to the chat window and expose the raw prompt/JSON.
    conversationMessages.push({
      role: "user",
      content: `Requested routine using ${selectedFull.length} selected product(s).`,
    });
    saveConversation();

    // Build the messages array for the API: include prior conversation for context, then
    // append the detailed JSON user message only in the payload sent to the worker (not persisted).
    const messages = [
      productsSystem,
      LOREAL_ONLY_SYSTEM_MESSAGE,
      systemMessage,
      ...conversationMessages,
      // detailed payload for the API call only (kept out of conversationMessages)
      { role: "user", content: userMessage.content },
    ];

    // UI feedback
    chatWindow.innerHTML =
      '<div class="placeholder-message">Generating routine…</div>';

    try {
      if (!WORKER_URL)
        throw new Error(
          "WORKER_URL not configured. Set the worker URL in script.js."
        );

      const data = await sendToWorker({ messages, model: "gpt-4o" });
      const content =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        JSON.stringify(data);

      if (content) {
        // store assistant response in conversation and render full history
        conversationMessages.push({ role: "assistant", content });
        saveConversation();
        renderChatHistory();

        // Post-process: recommend missing products for steps that reference categories the user didn't select
        const suggestions = await suggestMissingProducts(content, selected);
        if (suggestions && suggestions.length) {
          const listHtml = suggestions
            .map(
              (s) => `
            <li><strong>${escapeHtml(s.product.name)}</strong> (${escapeHtml(
                s.product.brand || ""
              )}) — ${escapeHtml(s.product.description || "")}</li>
          `
            )
            .join("");

          const suggestionsHtml = `<div class="ai-suggestions"><h4>Recommended products for missing steps</h4><ul>${listHtml}</ul></div>`;
          chatWindow.innerHTML += suggestionsHtml;
        }
      } else {
        chatWindow.innerHTML =
          '<div class="placeholder-message">No response from the API.</div>';
      }
    } catch (err) {
      chatWindow.innerHTML = `<div class="placeholder-message">Error generating routine: ${
        err.message || err
      }</div>`;
    }
  });
}

// ============================================================
// Pokemon Card Portfolio Tracker — Main Application
// ============================================================

const TCG_API = "https://api.pokemontcg.io/v2/cards";

let state = {
  dashboard: null,
  inventory: [],
  snapshots: [],
  sortColumn: "Total Value",
  sortDir: "desc",
  searchQuery: "",
  editingRowIndex: null,
  chartInstance: null,
  chartRange: "ALL",
  // TCG search
  tcgResults: [],
  selectedTcgCard: null,
  searchDebounceTimer: null,
};

// ============================================================
// INIT
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  if (!CONFIG.APPS_SCRIPT_URL) {
    showSetupScreen();
    return;
  }
  initApp();
});

function initApp() {
  setupEventListeners();
  loadDashboard();
  setInterval(loadDashboard, CONFIG.REFRESH_INTERVAL);
}

// ============================================================
// APPS SCRIPT API
// ============================================================

async function apiFetch(action, params = {}) {
  const url = new URL(CONFIG.APPS_SCRIPT_URL);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(action, data) {
  await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...data }),
    mode: "no-cors",
  });
  return { status: "success" };
}

// ============================================================
// POKEMON TCG API
// ============================================================

async function searchTCGCards(query) {
  if (!query || query.trim().length < 2) {
    setSearchState("idle");
    return;
  }
  setSearchState("loading");
  try {
    // Wrap in quotes for exact-name matching, fall back to prefix
    const q = encodeURIComponent(`name:"${query.trim()}"`);
    const res = await fetch(`${TCG_API}?q=${q}&pageSize=20&orderBy=-set.releaseDate`);
    if (!res.ok) throw new Error(`TCG API HTTP ${res.status}`);
    const json = await res.json();
    state.tcgResults = json.data || [];

    // If exact-name returns nothing, try prefix search
    if (state.tcgResults.length === 0) {
      const q2 = encodeURIComponent(`name:${query.trim()}*`);
      const res2 = await fetch(`${TCG_API}?q=${q2}&pageSize=20&orderBy=-set.releaseDate`);
      const json2 = await res2.json();
      state.tcgResults = json2.data || [];
    }

    if (state.tcgResults.length === 0) {
      setSearchState("empty");
    } else {
      renderTCGResults();
      setSearchState("results");
    }
  } catch (err) {
    setSearchState("error", err.message);
  }
}

function getHighestMarketPrice(card) {
  const prices = card.tcgplayer && card.tcgplayer.prices;
  if (!prices) return null;
  let highest = null;
  let highestVariant = null;
  for (const [variant, data] of Object.entries(prices)) {
    const market = data && data.market;
    if (market != null && (highest === null || market > highest)) {
      highest = market;
      highestVariant = variant;
    }
  }
  return highest !== null ? { price: highest, variant: highestVariant } : null;
}

function formatVariantLabel(variant) {
  return variant
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function renderTCGResults() {
  const grid = document.getElementById("search-results-grid");
  if (!grid) return;
  grid.innerHTML = state.tcgResults
    .map((card) => {
      const priceInfo = getHighestMarketPrice(card);
      const priceStr = priceInfo ? formatCurrency(priceInfo.price) : "No price";
      const variantStr = priceInfo ? ` <span class="price-variant">${formatVariantLabel(priceInfo.variant)}</span>` : "";
      const imgSrc = card.images && card.images.small ? card.images.small : "";
      return `
        <div class="tcg-card-result" onclick="selectTCGCard('${escHtml(card.id)}')">
          <div class="tcg-card-img-wrap">
            ${imgSrc
              ? `<img src="${escHtml(imgSrc)}" alt="${escHtml(card.name)}" loading="lazy" />`
              : `<div class="tcg-card-no-img">?</div>`}
          </div>
          <div class="tcg-card-info">
            <div class="tcg-card-name">${escHtml(card.name)}</div>
            <div class="tcg-card-set">${escHtml(card.set ? card.set.name : "")} · #${escHtml(card.number || "")}</div>
            <div class="tcg-card-price">${priceStr}${variantStr}</div>
          </div>
        </div>`;
    })
    .join("");
}

function selectTCGCard(cardId) {
  const card = state.tcgResults.find((c) => c.id === cardId);
  if (!card) return;
  state.selectedTcgCard = card;

  // Populate the preview banner
  const imgEl = document.getElementById("preview-card-img");
  if (imgEl) {
    imgEl.src = (card.images && card.images.small) || "";
    imgEl.style.display = card.images && card.images.small ? "block" : "none";
  }
  setText("preview-card-name", card.name);
  setText(
    "preview-card-meta",
    `${card.set ? card.set.name : ""} · #${card.number || ""}`
  );

  const priceInfo = getHighestMarketPrice(card);
  const priceEl = document.getElementById("preview-card-price");
  if (priceEl) {
    if (priceInfo) {
      priceEl.innerHTML = `Market: <strong>${formatCurrency(priceInfo.price)}</strong> <span class="price-variant">${formatVariantLabel(priceInfo.variant)}</span>`;
      // Pre-fill purchase price with market price
      const ppEl = document.getElementById("field-purchase-price");
      if (ppEl && !ppEl.value) ppEl.value = priceInfo.price.toFixed(2);
      // Also set current price
      const cpEl = document.getElementById("field-current-price");
      if (cpEl) cpEl.value = priceInfo.price.toFixed(2);
    } else {
      priceEl.textContent = "No TCGPlayer price available";
    }
  }

  // Switch from search view to form view
  showModalView("form");
  document.getElementById("modal-title").textContent = "Add to Collection";
  // Show back button, hide edit-only fields
  const backBtn = document.getElementById("back-to-search-btn");
  if (backBtn) backBtn.style.display = "flex";
  setCardFormReadOnly(false); // add mode: hide name/set/number fields (shown in banner)
}

function backToSearch() {
  state.selectedTcgCard = null;
  showModalView("search");
  document.getElementById("modal-title").textContent = "Add Card";
}

function showModalView(view) {
  const searchView = document.getElementById("modal-search-view");
  const formView = document.getElementById("modal-form-view");
  const modalBox = document.querySelector(".modal-box");
  if (view === "search") {
    searchView.style.display = "block";
    formView.style.display = "none";
    modalBox.classList.add("modal-box-wide");
  } else {
    searchView.style.display = "none";
    formView.style.display = "block";
    modalBox.classList.remove("modal-box-wide");
  }
}

function setSearchState(state, errorMsg) {
  const states = ["idle", "loading", "results", "empty", "error"];
  states.forEach((s) => {
    const el = document.getElementById(`search-${s}-state`);
    if (el) el.style.display = "none";
  });
  const grid = document.getElementById("search-results-grid");
  if (grid) grid.style.display = "none";

  if (state === "results") {
    const grid = document.getElementById("search-results-grid");
    if (grid) grid.style.display = "grid";
  } else {
    const el = document.getElementById(`search-${state}-state`);
    if (el) el.style.display = "flex";
    if (state === "error" && errorMsg) {
      const errEl = document.getElementById("search-error-msg");
      if (errEl) errEl.textContent = errorMsg;
    }
  }
}

// setCardFormReadOnly: in "add" mode, card identity fields are hidden (shown in banner)
// in "edit" mode, all fields are shown
function setCardFormReadOnly(isEdit) {
  const addOnlyFields = document.querySelectorAll(".form-add-hidden");
  const editOnlyFields = document.querySelectorAll(".form-edit-only");
  const banner = document.getElementById("selected-card-preview");
  addOnlyFields.forEach((el) => {
    el.style.display = isEdit ? "flex" : "none";
  });
  editOnlyFields.forEach((el) => {
    el.style.display = isEdit ? "flex" : "none";
  });
  if (banner) banner.style.display = isEdit ? "none" : "flex";
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadDashboard() {
  showGlobalLoader(true);
  try {
    const result = await apiFetch("getDashboard");
    if (result.status !== "success") throw new Error(result.message);
    state.dashboard = result.data;
    state.inventory = result.data.inventory || [];
    state.snapshots = result.data.snapshots || [];
    renderAll();
  } catch (err) {
    showError("Failed to load data: " + err.message);
  } finally {
    showGlobalLoader(false);
  }
}

// ============================================================
// RENDER
// ============================================================

function renderAll() {
  renderStats();
  renderChart();
  renderTable();
  renderTopStats();
  updateLastUpdated();
}

function renderStats() {
  const d = state.dashboard;
  if (!d) return;

  setText("stat-total-value", formatCurrency(d.totalValue));
  setText("stat-total-cards", d.totalCards || 0);

  const gainEl = document.getElementById("stat-gain");
  const gainPctEl = document.getElementById("stat-gain-pct");
  if (gainEl) {
    const gain = d.unrealizedGain || 0;
    gainEl.textContent = formatCurrency(gain, true);
    gainEl.className = "stat-value " + (gain >= 0 ? "positive" : "negative");
  }
  if (gainPctEl) {
    const pct = d.unrealizedGainPct || 0;
    gainPctEl.textContent = formatPct(pct, true);
    gainPctEl.className = "stat-badge " + (pct >= 0 ? "badge-positive" : "badge-negative");
  }

  const dailyEl = document.getElementById("stat-daily");
  const dailyPctEl = document.getElementById("stat-daily-pct");
  if (dailyEl) {
    const dc = d.dailyChange || 0;
    dailyEl.textContent = formatCurrency(dc, true);
    dailyEl.className = "stat-value " + (dc >= 0 ? "positive" : "negative");
  }
  if (dailyPctEl) {
    const dp = d.dailyChangePct || 0;
    dailyPctEl.textContent = formatPct(dp, true);
    dailyPctEl.className = "stat-badge " + (dp >= 0 ? "badge-positive" : "badge-negative");
  }
}

function renderTopStats() {
  const d = state.dashboard;
  if (!d || !state.inventory.length) return;

  const sorted = [...state.inventory].sort(
    (a, b) => (parseFloat(b["Current Price"]) || 0) - (parseFloat(a["Current Price"]) || 0)
  );
  const topCard = sorted[0];
  setText("top-card-name", topCard ? topCard["Card Name"] : "—");
  setText("top-card-value", topCard ? formatCurrency(parseFloat(topCard["Current Price"]) || 0) : "—");

  const avg = state.inventory.length ? d.totalValue / state.inventory.length : 0;
  setText("avg-card-value", formatCurrency(avg));

  setText("total-invested", formatCurrency(d.totalInvested || 0));
  setText("total-current", formatCurrency(d.totalValue || 0));

  const performers = state.inventory
    .map((c) => {
      const cur = parseFloat(c["Current Price"]) || 0;
      const buy = parseFloat(c["Purchase Price"]) || 0;
      const pct = buy > 0 ? ((cur - buy) / buy) * 100 : 0;
      return { name: c["Card Name"], pct };
    })
    .filter((c) => c.pct !== 0)
    .sort((a, b) => b.pct - a.pct);

  const best = performers[0];
  setText("best-performer", best ? best.name : "—");
  const bestEl = document.getElementById("best-performer-pct");
  if (bestEl && best) {
    bestEl.textContent = formatPct(best.pct, true);
    bestEl.className = best.pct >= 0 ? "positive" : "negative";
  }
}

function renderTable() {
  const tbody = document.getElementById("inventory-tbody");
  if (!tbody) return;

  let rows = [...state.inventory];

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r["Card Name"] || "").toLowerCase().includes(q) ||
        (r["Set"] || "").toLowerCase().includes(q) ||
        (r["Condition"] || "").toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => {
    let av = a[state.sortColumn] || "";
    let bv = b[state.sortColumn] || "";
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) {
      av = an; bv = bn;
    } else {
      av = String(av).toLowerCase();
      bv = String(bv).toLowerCase();
    }
    if (av < bv) return state.sortDir === "asc" ? -1 : 1;
    if (av > bv) return state.sortDir === "asc" ? 1 : -1;
    return 0;
  });

  // Update count
  const countEl = document.getElementById("table-count");
  if (countEl) countEl.textContent = rows.length === state.inventory.length
    ? `${rows.length} cards`
    : `${rows.length} of ${state.inventory.length}`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">
      ${state.searchQuery ? "No cards match your search." : 'No cards yet. Click <strong>+ Add Card</strong> to get started.'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((card) => {
      const cur = parseFloat(card["Current Price"]) || 0;
      const buy = parseFloat(card["Purchase Price"]) || 0;
      const qty = parseFloat(card["Quantity"]) || 1;
      const total = cur * qty;
      const change = cur - buy;
      const changePct = buy > 0 ? ((cur - buy) / buy) * 100 : 0;
      const changeClass = change >= 0 ? "positive" : "negative";
      const graded = card["Graded"] === "Yes";
      const imgUrl = card["Image URL"] || "";

      return `
      <tr data-row="${card._rowIndex}" class="table-row">
        <td>
          <div class="card-name-cell">
            ${imgUrl
              ? `<img src="${escHtml(imgUrl)}" alt="${escHtml(card["Card Name"] || "")}" class="card-thumb" loading="lazy" />`
              : `<div class="card-thumb-placeholder"></div>`}
            <div class="card-name-info">
              <span class="card-name">${escHtml(card["Card Name"] || "")}</span>
              ${graded ? `<span class="badge-grade">PSA ${escHtml(String(card["PSA Grade"] || ""))}</span>` : ""}
            </div>
          </div>
        </td>
        <td>${escHtml(card["Set"] || "")}</td>
        <td><span class="condition-badge condition-${(card["Condition"] || "").toLowerCase()}">${escHtml(card["Condition"] || "")}</span></td>
        <td>${qty}</td>
        <td>${formatCurrency(cur)}</td>
        <td class="${changeClass}">${formatCurrency(change, true)}<br><small>${formatPct(changePct, true)}</small></td>
        <td><strong>${formatCurrency(total)}</strong></td>
        <td>
          <div class="action-btns">
            <button class="btn-icon btn-edit" onclick="openEditModal(${card._rowIndex})" title="Edit">✏️</button>
            <button class="btn-icon btn-delete" onclick="confirmDelete(${card._rowIndex}, '${escHtml(card["Card Name"] || "")}')" title="Delete">🗑️</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

// ============================================================
// CHART
// ============================================================

function renderChart() {
  const canvas = document.getElementById("portfolio-chart");
  if (!canvas || !window.Chart) return;

  let snapshots = [...state.snapshots];

  const now = new Date();
  const rangeDays = {
    "1W": 7, "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "ALL": Infinity,
  }[state.chartRange] || Infinity;

  if (rangeDays !== Infinity) {
    const cutoff = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    snapshots = snapshots.filter((s) => new Date(s["Date"]) >= cutoff);
  }

  const labels = snapshots.map((s) => s["Date"]);
  const values = snapshots.map((s) => parseFloat(s["Total Portfolio Value"]) || 0);

  if (state.dashboard && state.dashboard.totalValue) {
    const today = new Date().toISOString().slice(0, 10);
    if (!labels.includes(today)) {
      labels.push(today);
      values.push(state.dashboard.totalValue);
    }
  }

  const gainColor = CONFIG.CHART_COLORS.gain;
  const lossColor = CONFIG.CHART_COLORS.loss;
  const firstVal = values[0] || 0;
  const lastVal = values[values.length - 1] || 0;
  const lineColor = lastVal >= firstVal ? gainColor : lossColor;

  if (state.chartInstance) {
    state.chartInstance.data.labels = labels;
    state.chartInstance.data.datasets[0].data = values;
    state.chartInstance.data.datasets[0].borderColor = lineColor;
    state.chartInstance.update("none");
    return;
  }

  state.chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Portfolio Value",
        data: values,
        borderColor: lineColor,
        backgroundColor: lineColor + "22",
        borderWidth: 2.5,
        pointRadius: labels.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a1a2e",
          borderColor: "#333366",
          borderWidth: 1,
          titleColor: "#aaa",
          bodyColor: "#fff",
          callbacks: { label: (ctx) => " " + formatCurrency(ctx.parsed.y) },
        },
      },
      scales: {
        x: {
          grid: { color: CONFIG.CHART_COLORS.gridLine },
          ticks: { color: "#888", maxTicksLimit: 8 },
        },
        y: {
          grid: { color: CONFIG.CHART_COLORS.gridLine },
          ticks: { color: "#888", callback: (v) => formatCurrency(v) },
        },
      },
    },
  });
}

// ============================================================
// MODAL — ADD (search-to-add) / EDIT
// ============================================================

function openAddModal() {
  state.editingRowIndex = null;
  state.selectedTcgCard = null;
  state.tcgResults = [];

  document.getElementById("modal-title").textContent = "Add Card";
  document.getElementById("card-form").reset();

  // Reset search
  const input = document.getElementById("tcg-search-input");
  if (input) input.value = "";
  setSearchState("idle");

  showModalView("search");
  document.getElementById("card-modal").classList.add("open");

  // Focus the search input after transition
  setTimeout(() => {
    const input = document.getElementById("tcg-search-input");
    if (input) input.focus();
  }, 50);
}

function openEditModal(rowIndex) {
  const card = state.inventory.find((c) => c._rowIndex === rowIndex);
  if (!card) return;
  state.editingRowIndex = rowIndex;
  state.selectedTcgCard = null;

  document.getElementById("modal-title").textContent = "Edit Card";

  fillFormField("field-name", card["Card Name"]);
  fillFormField("field-set", card["Set"]);
  fillFormField("field-number", card["Card Number"]);
  fillFormField("field-condition", card["Condition"]);
  fillFormField("field-qty", card["Quantity"]);
  fillFormField("field-graded", card["Graded"] === "Yes");
  fillFormField("field-psa", card["PSA Grade"]);
  fillFormField("field-purchase-price", card["Purchase Price"]);
  fillFormField("field-current-price", card["Current Price"]);
  fillFormField("field-url", card["PriceCharting URL"]);
  fillFormField("field-image-url", card["Image URL"]);
  fillFormField("field-notes", card["Notes"]);
  document.getElementById("field-date-added").value = card["Date Added"] || "";

  showModalView("form");
  setCardFormReadOnly(true); // edit mode: show all fields
  const backBtn = document.getElementById("back-to-search-btn");
  if (backBtn) backBtn.style.display = "none";

  document.getElementById("card-modal").classList.add("open");
}

function closeModal() {
  document.getElementById("card-modal").classList.remove("open");
  state.editingRowIndex = null;
  state.selectedTcgCard = null;
}

async function submitCardForm(e) {
  e.preventDefault();
  const btn = document.getElementById("form-submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  // Determine image URL: from selected TCG card (add mode) or from form field (edit mode)
  let imageUrl = "";
  if (state.selectedTcgCard) {
    imageUrl = (state.selectedTcgCard.images && state.selectedTcgCard.images.small) || "";
  } else {
    imageUrl = getFormVal("field-image-url");
  }

  // Card identity: from TCG card (add mode) or from form fields (edit mode)
  const cardName = state.selectedTcgCard
    ? state.selectedTcgCard.name
    : getFormVal("field-name");
  const cardSet = state.selectedTcgCard
    ? (state.selectedTcgCard.set ? state.selectedTcgCard.set.name : "")
    : getFormVal("field-set");
  const cardNumber = state.selectedTcgCard
    ? (state.selectedTcgCard.number || "")
    : getFormVal("field-number");

  const data = {
    cardName,
    set: cardSet,
    cardNumber,
    condition: getFormVal("field-condition"),
    quantity: getFormVal("field-qty"),
    graded: document.getElementById("field-graded").checked,
    psaGrade: getFormVal("field-psa"),
    purchasePrice: getFormVal("field-purchase-price"),
    currentPrice: getFormVal("field-current-price"),
    priceChartingUrl: getFormVal("field-url"),
    imageUrl,
    notes: getFormVal("field-notes"),
    dateAdded: getFormVal("field-date-added"),
  };

  try {
    if (state.editingRowIndex) {
      await apiPost("updateCard", { rowIndex: state.editingRowIndex, data });
      showToast("Card updated!");
    } else {
      await apiPost("addCard", { data });
      showToast("Card added!");
    }
    closeModal();
    setTimeout(loadDashboard, 1500);
  } catch (err) {
    showToast("Error: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Card";
  }
}

function confirmDelete(rowIndex, name) {
  const dialog = document.getElementById("confirm-dialog");
  document.getElementById("confirm-msg").textContent =
    `Delete "${name}"? This cannot be undone.`;
  dialog.classList.add("open");
  dialog.dataset.rowIndex = rowIndex;
}

function closeConfirm() {
  document.getElementById("confirm-dialog").classList.remove("open");
}

async function executeDelete() {
  const dialog = document.getElementById("confirm-dialog");
  const rowIndex = parseInt(dialog.dataset.rowIndex);
  closeConfirm();
  try {
    await apiPost("deleteCard", { rowIndex });
    showToast("Card deleted.");
    setTimeout(loadDashboard, 1500);
  } catch (err) {
    showToast("Error deleting card: " + err.message, "error");
  }
}

// ============================================================
// SETUP SCREEN
// ============================================================

function showSetupScreen() {
  document.getElementById("setup-screen").style.display = "flex";
  document.getElementById("main-app").style.display = "none";
}

function saveScriptUrl() {
  const url = document.getElementById("setup-url-input").value.trim();
  if (!url.startsWith("https://script.google.com")) {
    showToast("That doesn't look like a valid Apps Script URL.", "error");
    return;
  }
  localStorage.setItem("APPS_SCRIPT_URL", url);
  CONFIG.APPS_SCRIPT_URL = url;
  document.getElementById("setup-screen").style.display = "none";
  document.getElementById("main-app").style.display = "block";
  initApp();
}

// Check localStorage on load
(function () {
  const saved = localStorage.getItem("APPS_SCRIPT_URL");
  if (saved && !CONFIG.APPS_SCRIPT_URL) CONFIG.APPS_SCRIPT_URL = saved;
})();

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
  // Inventory filter search
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderTable();
    });
  }

  // TCG card search (debounced)
  const tcgInput = document.getElementById("tcg-search-input");
  if (tcgInput) {
    tcgInput.addEventListener("input", (e) => {
      clearTimeout(state.searchDebounceTimer);
      const val = e.target.value.trim();
      if (!val) {
        setSearchState("idle");
        return;
      }
      setSearchState("loading");
      state.searchDebounceTimer = setTimeout(() => {
        searchTCGCards(val);
      }, 500);
    });
  }

  // Sort headers
  document.querySelectorAll("[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (state.sortColumn === col) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortColumn = col;
        state.sortDir = "desc";
      }
      document.querySelectorAll("[data-sort]").forEach((h) => h.classList.remove("sort-asc", "sort-desc"));
      th.classList.add("sort-" + state.sortDir);
      renderTable();
    });
  });

  // Chart range buttons
  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartRange = btn.dataset.range;
      if (state.chartInstance) {
        state.chartInstance.destroy();
        state.chartInstance = null;
      }
      renderChart();
    });
  });

  // Card form submit
  const form = document.getElementById("card-form");
  if (form) form.addEventListener("submit", submitCardForm);

  // Modal close on backdrop click
  document.getElementById("card-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Confirm dialog
  document.getElementById("confirm-yes").addEventListener("click", executeDelete);
  document.getElementById("confirm-no").addEventListener("click", closeConfirm);

  // Settings URL update
  const updateUrlBtn = document.getElementById("update-url-btn");
  if (updateUrlBtn) {
    updateUrlBtn.addEventListener("click", () => {
      const newUrl = prompt("Enter your new Apps Script URL:");
      if (newUrl && newUrl.startsWith("https://")) {
        localStorage.setItem("APPS_SCRIPT_URL", newUrl);
        CONFIG.APPS_SCRIPT_URL = newUrl;
        showToast("URL updated. Reloading data…");
        setTimeout(loadDashboard, 500);
      }
    });
  }
}

// ============================================================
// UTILITIES
// ============================================================

function formatCurrency(val, signed = false) {
  const n = parseFloat(val) || 0;
  const prefix = signed && n > 0 ? "+" : "";
  return prefix + new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2,
  }).format(n);
}

function formatPct(val, signed = false) {
  const n = parseFloat(val) || 0;
  const prefix = signed && n > 0 ? "+" : "";
  return prefix + n.toFixed(2) + "%";
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function getFormVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function fillFormField(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el.type === "checkbox") el.checked = !!value;
  else el.value = value || "";
}

function showGlobalLoader(show) {
  const el = document.getElementById("global-loader");
  if (el) el.style.display = show ? "flex" : "none";
}

function showError(msg) {
  showToast(msg, "error");
}

function showToast(msg, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function updateLastUpdated() {
  const el = document.getElementById("last-updated");
  if (el) el.textContent = "Updated " + new Date().toLocaleTimeString();
}

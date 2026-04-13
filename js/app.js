// ============================================================
// Pokemon Card Portfolio Tracker — Main Application
// ============================================================

const TCG_API = "https://api.pokemontcg.io/v2/cards";

let state = {
  // Dashboard data
  dashboard: null,
  inventory: [],
  psaPopulation: {},

  // Table
  sortColumn: "Total Value",
  sortDir: "desc",
  searchQuery: "",

  // Add/edit modal
  editingRowIndex: null,
  selectedTcgCard: null,
  searchDebounceTimer: null,
  tcgResults: [],

  // Portfolio chart
  chartInstance: null,
  chartRange: "ALL",
  allPriceHistory: null,   // cached getAllPriceHistory data

  // Card detail modal
  detailCard: null,
  detailRange: "ALL",
  priceHistoryChart: null,
  volumeChart: null,
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
  if (!query || query.trim().length < 2) { setSearchState("idle"); return; }
  setSearchState("loading");
  try {
    const q = encodeURIComponent(`name:"${query.trim()}"`);
    const res = await fetch(`${TCG_API}?q=${q}&pageSize=20&orderBy=-set.releaseDate`);
    if (!res.ok) throw new Error(`TCG API HTTP ${res.status}`);
    const json = await res.json();
    state.tcgResults = json.data || [];
    if (!state.tcgResults.length) {
      const q2 = encodeURIComponent(`name:${query.trim()}*`);
      const res2 = await fetch(`${TCG_API}?q=${q2}&pageSize=20&orderBy=-set.releaseDate`);
      const json2 = await res2.json();
      state.tcgResults = json2.data || [];
    }
    state.tcgResults.length ? (renderTCGResults(), setSearchState("results")) : setSearchState("empty");
  } catch (err) {
    setSearchState("error", err.message);
  }
}

function getHighestMarketPrice(card) {
  const prices = card.tcgplayer && card.tcgplayer.prices;
  if (!prices) return null;
  let highest = null, highestVariant = null;
  for (const [variant, data] of Object.entries(prices)) {
    const market = data && data.market;
    if (market != null && (highest === null || market > highest)) {
      highest = market; highestVariant = variant;
    }
  }
  return highest !== null ? { price: highest, variant: highestVariant } : null;
}

function formatVariantLabel(variant) {
  return variant.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase()).trim();
}

function renderTCGResults() {
  const grid = document.getElementById("search-results-grid");
  if (!grid) return;
  grid.innerHTML = state.tcgResults.map(card => {
    const priceInfo = getHighestMarketPrice(card);
    const priceStr = priceInfo ? formatCurrency(priceInfo.price) : "No price";
    const variantStr = priceInfo ? ` <span class="price-variant">${formatVariantLabel(priceInfo.variant)}</span>` : "";
    const imgSrc = card.images && card.images.small ? card.images.small : "";
    return `
      <div class="tcg-card-result" onclick="selectTCGCard('${escHtml(card.id)}')">
        <div class="tcg-card-img-wrap">
          ${imgSrc ? `<img src="${escHtml(imgSrc)}" alt="${escHtml(card.name)}" loading="lazy" />` : `<div class="tcg-card-no-img">?</div>`}
        </div>
        <div class="tcg-card-info">
          <div class="tcg-card-name">${escHtml(card.name)}</div>
          <div class="tcg-card-set">${escHtml(card.set ? card.set.name : "")} · #${escHtml(card.number || "")}</div>
          <div class="tcg-card-price">${priceStr}${variantStr}</div>
        </div>
      </div>`;
  }).join("");
}

function selectTCGCard(cardId) {
  const card = state.tcgResults.find(c => c.id === cardId);
  if (!card) return;
  state.selectedTcgCard = card;

  const imgEl = document.getElementById("preview-card-img");
  if (imgEl) {
    imgEl.src = (card.images && card.images.small) || "";
    imgEl.style.display = card.images && card.images.small ? "block" : "none";
  }
  setText("preview-card-name", card.name);
  setText("preview-card-meta", `${card.set ? card.set.name : ""} · #${card.number || ""}`);

  const priceInfo = getHighestMarketPrice(card);
  const priceEl = document.getElementById("preview-card-price");
  if (priceEl) {
    if (priceInfo) {
      priceEl.innerHTML = `Market: <strong>${formatCurrency(priceInfo.price)}</strong> <span class="price-variant">${formatVariantLabel(priceInfo.variant)}</span>`;
      const ppEl = document.getElementById("field-purchase-price");
      if (ppEl && !ppEl.value) ppEl.value = priceInfo.price.toFixed(2);
      const cpEl = document.getElementById("field-current-price");
      if (cpEl) cpEl.value = priceInfo.price.toFixed(2);
    } else {
      priceEl.textContent = "No TCGPlayer price available";
    }
  }
  showModalView("form");
  document.getElementById("modal-title").textContent = "Add to Collection";
  const backBtn = document.getElementById("back-to-search-btn");
  if (backBtn) backBtn.style.display = "flex";
  setCardFormReadOnly(false);
}

function backToSearch() {
  state.selectedTcgCard = null;
  showModalView("search");
  document.getElementById("modal-title").textContent = "Add Card";
}

function showModalView(view) {
  const searchView = document.getElementById("modal-search-view");
  const formView   = document.getElementById("modal-form-view");
  const modalBox   = document.querySelector(".modal-box");
  searchView.style.display = view === "search" ? "block" : "none";
  formView.style.display   = view === "form"   ? "block" : "none";
  modalBox && modalBox.classList.toggle("modal-box-wide", view === "search");
}

function setSearchState(s, errorMsg) {
  ["idle","loading","results","empty","error"].forEach(name => {
    const el = document.getElementById(`search-${name}-state`);
    if (el) el.style.display = "none";
  });
  const grid = document.getElementById("search-results-grid");
  if (grid) grid.style.display = "none";
  if (s === "results") {
    if (grid) grid.style.display = "grid";
  } else {
    const el = document.getElementById(`search-${s}-state`);
    if (el) el.style.display = "flex";
    if (s === "error" && errorMsg) {
      const errEl = document.getElementById("search-error-msg");
      if (errEl) errEl.textContent = errorMsg;
    }
  }
}

function setCardFormReadOnly(isEdit) {
  document.querySelectorAll(".form-add-hidden").forEach(el => { el.style.display = isEdit ? "flex" : "none"; });
  document.querySelectorAll(".form-edit-only").forEach(el => { el.style.display = isEdit ? "flex" : "none"; });
  const banner = document.getElementById("selected-card-preview");
  if (banner) banner.style.display = isEdit ? "none" : "flex";
}

// ============================================================
// CONDITION TOGGLE
// ============================================================

function setGradedMode(graded) {
  const ungradedBtn = document.getElementById("toggle-ungraded");
  const gradedBtn   = document.getElementById("toggle-graded");
  const condWrap    = document.getElementById("field-condition-wrap");
  const psaWrap     = document.getElementById("field-psa-wrap");
  if (!ungradedBtn) return;
  ungradedBtn.classList.toggle("active", !graded);
  gradedBtn.classList.toggle("active",   graded);
  condWrap.style.display = graded ? "none" : "";
  psaWrap.style.display  = graded ? ""     : "none";
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadDashboard() {
  showGlobalLoader(true);
  try {
    const [result] = await Promise.all([
      apiFetch("getDashboard"),
      loadAllPriceHistory(),   // fetch in parallel so chart renders immediately
    ]);
    if (result.status !== "success") throw new Error(result.message);
    state.dashboard     = result.data;
    state.inventory     = result.data.inventory || [];
    state.psaPopulation = result.data.psaPopulation || {};
    renderAll();
  } catch (err) {
    showError("Failed to load data: " + err.message);
  } finally {
    showGlobalLoader(false);
  }
}

async function loadAllPriceHistory() {
  if (state.allPriceHistory) return state.allPriceHistory;
  try {
    const result = await apiFetch("getAllPriceHistory");
    if (result.status === "success") {
      state.allPriceHistory = result.data || [];
      return state.allPriceHistory;
    }
  } catch (err) {
    console.warn("Could not load all price history:", err);
  }
  state.allPriceHistory = [];
  return [];
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

  const gainEl    = document.getElementById("stat-gain");
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

  const dailyEl    = document.getElementById("stat-daily");
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
  setText("top-card-name",  topCard ? topCard["Card Name"] : "—");
  setText("top-card-value", topCard ? formatCurrency(parseFloat(topCard["Current Price"]) || 0) : "—");

  const avg = state.inventory.length ? d.totalValue / state.inventory.length : 0;
  setText("avg-card-value", formatCurrency(avg));
  setText("total-invested", formatCurrency(d.totalInvested || 0));
  setText("total-current",  formatCurrency(d.totalValue    || 0));

  const performers = state.inventory
    .map(c => {
      const cur = parseFloat(c["Current Price"]) || 0;
      const buy = parseFloat(c["Purchase Price"]) || 0;
      return { name: c["Card Name"], pct: buy > 0 ? ((cur - buy) / buy) * 100 : 0 };
    })
    .filter(c => c.pct !== 0)
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
    rows = rows.filter(r =>
      (r["Card Name"] || "").toLowerCase().includes(q) ||
      (r["Set"]       || "").toLowerCase().includes(q) ||
      (r["Condition"] || "").toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => {
    let av = a[state.sortColumn] || "";
    let bv = b[state.sortColumn] || "";
    const an = parseFloat(av), bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) { av = an; bv = bn; }
    else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
    if (av < bv) return state.sortDir === "asc" ? -1 : 1;
    if (av > bv) return state.sortDir === "asc" ? 1  : -1;
    return 0;
  });

  const countEl = document.getElementById("table-count");
  if (countEl) countEl.textContent = rows.length === state.inventory.length
    ? `${rows.length} cards`
    : `${rows.length} of ${state.inventory.length}`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">
      ${state.searchQuery ? "No cards match your search." : 'No cards yet. Click <strong>+ Add Card</strong> to get started.'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(card => {
    const cur     = parseFloat(card["Current Price"])  || 0;
    const buy     = parseFloat(card["Purchase Price"]) || 0;
    const qty     = parseFloat(card["Quantity"])       || 1;
    const total   = cur * qty;
    const change  = cur - buy;
    const changePct = buy > 0 ? ((cur - buy) / buy) * 100 : 0;
    const changeClass = change >= 0 ? "positive" : "negative";
    const graded  = card["Graded"] === "Yes";
    const imgUrl  = card["Image URL"] || "";

    return `
    <tr data-row="${card._rowIndex}" class="table-row" onclick="openCardDetail(${card._rowIndex})">
      <td>
        <div class="card-name-cell">
          ${imgUrl
            ? `<img src="${escHtml(imgUrl)}" alt="${escHtml(card["Card Name"] || "")}" class="card-thumb" loading="lazy" onerror="this.style.display='none'" />`
            : `<div class="card-thumb-placeholder"></div>`}
          <div class="card-name-info">
            <span class="card-name">${escHtml(card["Card Name"] || "")}</span>
            ${graded ? `<span class="badge-grade">PSA ${escHtml(String(card["PSA Grade"] || ""))}</span>` : ""}
          </div>
        </div>
      </td>
      <td>${escHtml(card["Set"] || "")}</td>
      <td><span class="condition-badge condition-${(card["Condition"] || "").toLowerCase().replace(/\s/g,"-")}">${escHtml(card["Condition"] || "")}</span></td>
      <td>${qty}</td>
      <td>${formatCurrency(cur)}</td>
      <td class="${changeClass}">${formatCurrency(change, true)}<br><small>${formatPct(changePct, true)}</small></td>
      <td><strong>${formatCurrency(total)}</strong></td>
      <td>${escHtml(card["Purchase Date"] || "—")}</td>
      <td>
        <div class="action-btns">
          <button class="btn-icon btn-edit" onclick="event.stopPropagation();openEditModal(${card._rowIndex})" title="Edit">✏️</button>
          <button class="btn-icon btn-delete" onclick="event.stopPropagation();confirmDelete(${card._rowIndex}, '${escHtml(card["Card Name"] || "")}')" title="Delete">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ============================================================
// PORTFOLIO CHART
// ============================================================

function renderChart() {
  const canvas   = document.getElementById("portfolio-chart");
  const noDataEl = document.getElementById("chart-no-data");
  if (!canvas || !window.Chart) return;

  function showNoData(msg) {
    canvas.style.display = "none";
    if (noDataEl) { noDataEl.style.display = "flex"; noDataEl.textContent = msg || ""; }
    if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }
  }

  console.log("[chart] allPriceHistory:", state.allPriceHistory);

  if (!state.allPriceHistory || !state.allPriceHistory.length) {
    showNoData("Run the price scraper to see portfolio history.");
    return;
  }

  let calc = calculateHistoricalPortfolio(state.allPriceHistory, state.inventory);
  console.log("[chart] calc results:", calc);

  // Apply range filter (month-based cutoff)
  if (state.chartRange !== "ALL") {
    const monthsBack = { "1W": 1, "1M": 1, "3M": 3, "6M": 6, "1Y": 12 }[state.chartRange] || 0;
    if (monthsBack > 0) {
      const now = new Date();
      const c   = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
      const cutoffStr = c.getFullYear() + "-" + String(c.getMonth() + 1).padStart(2, "0");
      calc = calc.filter(p => p.date >= cutoffStr);
    }
  }

  if (!calc.length) {
    showNoData("No price history data for this time range.");
    return;
  }

  canvas.style.display = "";
  if (noDataEl) noDataEl.style.display = "none";

  const labels = calc.map(p => p.date);
  const values = calc.map(p => p.value);

  const gainColor = CONFIG.CHART_COLORS.gain;
  const lossColor = CONFIG.CHART_COLORS.loss;
  const lineColor = (values[values.length - 1] || 0) >= (values[0] || 0) ? gainColor : lossColor;

  if (state.chartInstance) {
    state.chartInstance.data.labels = labels;
    state.chartInstance.data.datasets[0].data = values;
    state.chartInstance.data.datasets[0].borderColor = lineColor;
    state.chartInstance.data.datasets[0].backgroundColor = lineColor + "22";
    state.chartInstance.update("none");
    return;
  }

  state.chartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Portfolio Value", data: values,
        borderColor: lineColor, backgroundColor: lineColor + "22",
        borderWidth: 2.5, pointRadius: labels.length > 30 ? 0 : 3,
        pointHoverRadius: 5, fill: true, tension: 0.3 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a1a2e", borderColor: "#333366", borderWidth: 1,
          titleColor: "#aaa", bodyColor: "#fff",
          callbacks: {
            title: function(items) {
              const label = items[0] && items[0].label;
              if (!label) return "";
              const parts = label.split("-");
              return new Date(+parts[0], +parts[1] - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
            },
            label: ctx => " " + formatCurrency(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: { grid: { color: CONFIG.CHART_COLORS.gridLine }, ticks: { color: "#888", maxTicksLimit: 8,
          callback: function(value) {
            const label = this.getLabelForValue(value);
            if (!label) return "";
            const parts = label.split("-");
            return new Date(+parts[0], +parts[1] - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
          },
        }},
        y: { grid: { color: CONFIG.CHART_COLORS.gridLine }, ticks: { color: "#888", callback: v => formatCurrency(v) } },
      },
    },
  });
}

// ============================================================
// HISTORICAL PORTFOLIO CALCULATION
// ============================================================

function calculateHistoricalPortfolio(allHistory, inventory) {
  console.log("[calc] allHistory length:", allHistory.length, "inventory length:", inventory.length);
  if (!allHistory.length || !inventory.length) return [];

  // Build map: "cardName|||set|||condType" -> { "YYYY-MM": price }
  const priceMap = {};
  for (const row of allHistory) {
    const key = `${row.cardName}|||${row.set}|||${row.conditionType}`;
    if (!priceMap[key]) priceMap[key] = {};
    priceMap[key][row.date] = row.price;
  }
  console.log("[calc] priceMap keys:", Object.keys(priceMap));

  // Determine condition type per card
  function condTypeForCard(card) {
    const cond = String(card["Condition"] || "").toUpperCase();
    if (cond.startsWith("PSA 10")) return "psa10";
    if (cond.startsWith("PSA 9"))  return "psa9";
    return "ungraded";
  }

  // Find closest price at or before target month
  function priceAtMonth(monthMap, targetMonth) {
    if (!monthMap) return null;
    if (monthMap[targetMonth]) return monthMap[targetMonth];
    const months = Object.keys(monthMap).filter(m => m <= targetMonth).sort();
    return months.length ? monthMap[months[months.length - 1]] : null;
  }

  // Collect all months across the history data
  const allMonths = [...new Set(allHistory.map(r => r.date))].sort();
  if (!allMonths.length) return [];

  const results = [];
  for (const month of allMonths) {
    let totalValue = 0;
    for (const card of inventory) {
      const purchaseDate = (card["Purchase Date"] || card["Date Added"] || "").slice(0, 7);
      if (purchaseDate && purchaseDate > month) continue; // card not yet owned
      const condType = condTypeForCard(card);
      const key = `${card["Card Name"]}|||${card["Set"]}|||${condType}`;
      const qty = parseFloat(card["Quantity"]) || 1;
      const price = priceAtMonth(priceMap[key], month)
        ?? parseFloat(card["Current Price"]) ?? 0;
      console.log("[calc]", month, "|", card["Card Name"], "| condType:", condType, "| inPriceMap:", !!priceMap[key], "| price:", price, "| qty:", qty);
      totalValue += price * qty;
    }
    results.push({ date: month, value: totalValue });
  }
  return results;
}

// ============================================================
// CARD DETAIL MODAL
// ============================================================

function openCardDetail(rowIndex) {
  const card = state.inventory.find(c => c._rowIndex === rowIndex);
  if (!card) return;
  state.detailCard = card;
  state.detailRange = "ALL";
  document.querySelectorAll(".detail-range-btn").forEach(b => b.classList.toggle("active", b.dataset.range === "ALL"));

  // Header
  setText("detail-card-name", card["Card Name"] || "");
  setText("detail-card-meta", `${card["Set"] || ""}${card["Card Number"] ? " · #" + card["Card Number"] : ""}`);

  // Image
  const imgEl = document.getElementById("detail-card-img");
  if (imgEl) {
    imgEl.src   = card["Image URL"] || "";
    imgEl.style.display = card["Image URL"] ? "block" : "none";
    imgEl.onerror = function() { this.style.display = "none"; };
  }

  // Stats
  const cur   = parseFloat(card["Current Price"])  || 0;
  const buy   = parseFloat(card["Purchase Price"]) || 0;
  const qty   = parseFloat(card["Quantity"])       || 1;
  const gain  = cur - buy;
  const gainPct = buy > 0 ? ((cur - buy) / buy) * 100 : 0;
  setText("detail-current-price",  formatCurrency(cur));
  setText("detail-purchase-price", formatCurrency(buy));
  setText("detail-total-value",    formatCurrency(cur * qty));
  setText("detail-condition",      card["Condition"] || "—");
  setText("detail-purchase-date",  card["Purchase Date"] || "—");

  const gainEl = document.getElementById("detail-gain");
  if (gainEl) {
    gainEl.textContent = formatCurrency(gain, true);
    gainEl.className   = "detail-stat-value " + (gain >= 0 ? "positive" : "negative");
  }
  const gainPctEl = document.getElementById("detail-gain-pct");
  if (gainPctEl) {
    gainPctEl.textContent = formatPct(gainPct, true);
    gainPctEl.className   = gain >= 0 ? "positive" : "negative";
  }

  // PSA population
  const popKey = `${card["Card Name"]}|||${card["Set"]}`;
  const pop    = state.psaPopulation[popKey];
  const popRow = document.getElementById("detail-psa-pop");
  if (pop && (pop.psa9Pop != null || pop.psa10Pop != null)) {
    setText("detail-psa9-pop",  pop.psa9Pop  != null ? pop.psa9Pop.toLocaleString()  : "—");
    setText("detail-psa10-pop", pop.psa10Pop != null ? pop.psa10Pop.toLocaleString() : "—");
    if (popRow) popRow.style.display = "flex";
  } else {
    if (popRow) popRow.style.display = "none";
  }

  // Edit button wires up rowIndex
  const editBtn = document.getElementById("detail-edit-btn");
  if (editBtn) editBtn.dataset.rowIndex = rowIndex;

  // Show modal, reset chart state
  document.getElementById("card-detail-modal").classList.add("open");
  showDetailChartState("loading");

  // Destroy old charts
  if (state.priceHistoryChart) { state.priceHistoryChart.destroy(); state.priceHistoryChart = null; }
  if (state.volumeChart)       { state.volumeChart.destroy();       state.volumeChart = null;       }

  // Load and render price history
  loadAndRenderDetailCharts(card);
}

function closeDetailModal() {
  document.getElementById("card-detail-modal").classList.remove("open");
  state.detailCard = null;
}

function closeDetailAndEdit() {
  const btn = document.getElementById("detail-edit-btn");
  const rowIndex = btn ? parseInt(btn.dataset.rowIndex) : null;
  closeDetailModal();
  if (rowIndex) setTimeout(() => openEditModal(rowIndex), 50);
}

async function loadAndRenderDetailCharts(card) {
  try {
    const result = await apiFetch("getCardPriceHistory", {
      cardName: card["Card Name"] || "",
      set: card["Set"] || "",
    });
    if (result.status !== "success") throw new Error(result.message);
    const data = result.data;
    const hasData = Object.values(data).some(arr => arr.length > 0);
    if (!hasData) {
      showDetailChartState("empty");
      return;
    }
    showDetailChartState("charts");
    renderDetailPriceChart(data, state.detailRange);
    renderDetailVolumeChart(data, state.detailRange);
    // Store for range-switching
    card._priceHistoryData = data;
  } catch (err) {
    showDetailChartState("empty");
    console.warn("Price history load error:", err);
  }
}

function showDetailChartState(state) {
  document.getElementById("detail-chart-loading").style.display = state === "loading" ? "flex"  : "none";
  document.getElementById("detail-chart-empty").style.display   = state === "empty"   ? "flex"  : "none";
  document.getElementById("detail-charts-wrap").style.display   = state === "charts"  ? "block" : "none";
}

function filterHistoryByRange(points, range) {
  if (range === "ALL") return points;
  const months = { "6M": 6, "1Y": 12, "2Y": 24 }[range] || 9999;
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const cutoffStr = cutoff.toISOString().slice(0, 7);
  return points.filter(p => p.date >= cutoffStr);
}

function renderDetailPriceChart(data, range) {
  const canvas = document.getElementById("price-history-chart");
  if (!canvas) return;

  const ug   = filterHistoryByRange(data.ungraded || [], range);
  const psa9 = filterHistoryByRange(data.psa9     || [], range);
  const psa10= filterHistoryByRange(data.psa10    || [], range);

  // Build unified label set
  const allDates = [...new Set([
    ...ug.map(p => p.date), ...psa9.map(p => p.date), ...psa10.map(p => p.date)
  ])].sort();

  if (!allDates.length) { showDetailChartState("empty"); return; }

  function toSparseData(points, labels) {
    const map = Object.fromEntries(points.map(p => [p.date, p.price]));
    return labels.map(d => map[d] != null ? map[d] : null);
  }

  const datasets = [];
  if (ug.length)   datasets.push({ label: "Ungraded", data: toSparseData(ug,   allDates), borderColor: "#4e9af1", backgroundColor: "#4e9af122", fill: false, tension: 0.3, borderWidth: 2, pointRadius: allDates.length > 24 ? 0 : 3, spanGaps: true });
  if (psa9.length) datasets.push({ label: "PSA 9",    data: toSparseData(psa9, allDates), borderColor: "#c0c0c0", backgroundColor: "transparent",            fill: false, tension: 0.3, borderWidth: 2, pointRadius: allDates.length > 24 ? 0 : 3, spanGaps: true });
  if (psa10.length)datasets.push({ label: "PSA 10",   data: toSparseData(psa10,allDates), borderColor: "#e8b923", backgroundColor: "transparent",            fill: false, tension: 0.3, borderWidth: 2, pointRadius: allDates.length > 24 ? 0 : 3, spanGaps: true });

  if (state.priceHistoryChart) { state.priceHistoryChart.destroy(); state.priceHistoryChart = null; }

  state.priceHistoryChart = new Chart(canvas, {
    type: "line",
    data: { labels: allDates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1a1a2e", borderColor: "#333366", borderWidth: 1,
          callbacks: {
            title: function(items) {
              const label = items[0] && items[0].label;
              if (!label) return "";
              const [yr, mo] = label.split("-");
              return new Date(+yr, +mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
            },
            label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: { grid: { color: CONFIG.CHART_COLORS.gridLine }, ticks: { color: "#888", maxTicksLimit: 8,
          callback: function(value) {
            const label = this.getLabelForValue(value);
            if (!label) return "";
            const [yr, mo] = label.split("-");
            return new Date(+yr, +mo - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
          },
        }},
        y: { grid: { color: CONFIG.CHART_COLORS.gridLine }, ticks: { color: "#888", callback: v => formatCurrency(v) } },
      },
    },
  });
}

function renderDetailVolumeChart(data, range) {
  const canvas = document.getElementById("volume-chart");
  if (!canvas) return;

  const ug   = filterHistoryByRange(data.ungraded || [], range).filter(p => p.volume != null);
  const psa9 = filterHistoryByRange(data.psa9     || [], range).filter(p => p.volume != null);
  const psa10= filterHistoryByRange(data.psa10    || [], range).filter(p => p.volume != null);

  if (!ug.length && !psa9.length && !psa10.length) return; // no volume data at all

  const allDates = [...new Set([...ug.map(p=>p.date),...psa9.map(p=>p.date),...psa10.map(p=>p.date)])].sort();

  function toVol(points, labels) {
    const map = Object.fromEntries(points.map(p => [p.date, p.volume]));
    return labels.map(d => map[d] != null ? map[d] : 0);
  }

  const datasets = [];
  if (ug.length)   datasets.push({ label: "Ungraded", data: toVol(ug,   allDates), backgroundColor: "#4e9af166" });
  if (psa9.length) datasets.push({ label: "PSA 9",    data: toVol(psa9, allDates), backgroundColor: "#c0c0c066" });
  if (psa10.length)datasets.push({ label: "PSA 10",   data: toVol(psa10,allDates), backgroundColor: "#e8b92366" });

  if (state.volumeChart) { state.volumeChart.destroy(); state.volumeChart = null; }

  state.volumeChart = new Chart(canvas, {
    type: "bar",
    data: { labels: allDates, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#1a1a2e",
        callbacks: {
          title: function(items) {
            const label = items[0] && items[0].label;
            if (!label) return "";
            const [yr, mo] = label.split("-");
            return new Date(+yr, +mo - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
          },
        },
      }},
      scales: {
        x: { stacked: true, grid: { color: CONFIG.CHART_COLORS.gridLine }, ticks: { color: "#888", maxTicksLimit: 8,
          callback: function(value) {
            const label = this.getLabelForValue(value);
            if (!label) return "";
            const [yr, mo] = label.split("-");
            return new Date(+yr, +mo - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
          },
        }},
        y: { stacked: true, grid: { color: CONFIG.CHART_COLORS.gridLine }, ticks: { color: "#888" } },
      },
    },
  });
}

// ============================================================
// ADD MODAL
// ============================================================

function openAddModal() {
  state.editingRowIndex = null;
  state.selectedTcgCard = null;
  state.tcgResults = [];

  document.getElementById("modal-title").textContent = "Add Card";
  document.getElementById("card-form").reset();
  document.getElementById("field-purchase-date").value = new Date().toISOString().slice(0, 10);
  setGradedMode(false);

  const input = document.getElementById("tcg-search-input");
  if (input) input.value = "";
  setSearchState("idle");

  showModalView("search");
  document.getElementById("card-modal").classList.add("open");
  setTimeout(() => { const inp = document.getElementById("tcg-search-input"); if (inp) inp.focus(); }, 50);
}

function openEditModal(rowIndex) {
  const card = state.inventory.find(c => c._rowIndex === rowIndex);
  if (!card) return;
  state.editingRowIndex = rowIndex;
  state.selectedTcgCard = null;

  document.getElementById("modal-title").textContent = "Edit Card";

  fillFormField("field-name",   card["Card Name"]);
  fillFormField("field-set",    card["Set"]);
  fillFormField("field-number", card["Card Number"]);
  fillFormField("field-qty",    card["Quantity"]);

  const isPsa = String(card["Condition"] || "").startsWith("PSA");
  setGradedMode(isPsa);
  if (isPsa) {
    fillFormField("field-psa", card["PSA Grade"] || String(card["Condition"]).replace("PSA ", ""));
  } else {
    fillFormField("field-condition", card["Condition"]);
  }

  fillFormField("field-purchase-price", card["Purchase Price"]);
  fillFormField("field-purchase-date",  card["Purchase Date"]);
  fillFormField("field-current-price",  card["Current Price"]);
  fillFormField("field-url",            card["PriceCharting URL"]);
  fillFormField("field-image-url",      card["Image URL"]);
  fillFormField("field-notes",          card["Notes"]);
  document.getElementById("field-date-added").value = card["Date Added"] || "";

  showModalView("form");
  setCardFormReadOnly(true);
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

  const isGraded = document.getElementById("toggle-graded").classList.contains("active");
  const psaGrade = isGraded ? getFormVal("field-psa") : "";
  const condition = isGraded
    ? (psaGrade ? `PSA ${psaGrade}` : "PSA")
    : getFormVal("field-condition");

  let imageUrl = state.selectedTcgCard
    ? ((state.selectedTcgCard.images && state.selectedTcgCard.images.small) || "")
    : getFormVal("field-image-url");

  const cardName   = state.selectedTcgCard ? state.selectedTcgCard.name : getFormVal("field-name");
  const cardSet    = state.selectedTcgCard ? (state.selectedTcgCard.set ? state.selectedTcgCard.set.name : "") : getFormVal("field-set");
  const cardNumber = state.selectedTcgCard ? (state.selectedTcgCard.number || "") : getFormVal("field-number");

  const data = {
    cardName, set: cardSet, cardNumber, condition,
    quantity:       getFormVal("field-qty"),
    graded:         isGraded,
    psaGrade,
    purchasePrice:  getFormVal("field-purchase-price"),
    purchaseDate:   getFormVal("field-purchase-date"),
    currentPrice:   getFormVal("field-current-price"),
    priceChartingUrl: getFormVal("field-url"),
    imageUrl,
    notes:          getFormVal("field-notes"),
    dateAdded:      getFormVal("field-date-added"),
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

// ============================================================
// DELETE
// ============================================================

function confirmDelete(rowIndex, name) {
  const dialog = document.getElementById("confirm-dialog");
  document.getElementById("confirm-msg").textContent = `Delete "${name}"? This cannot be undone.`;
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
    showToast("That doesn't look like a valid Apps Script URL.", "error"); return;
  }
  localStorage.setItem("APPS_SCRIPT_URL", url);
  CONFIG.APPS_SCRIPT_URL = url;
  document.getElementById("setup-screen").style.display = "none";
  document.getElementById("main-app").style.display = "block";
  initApp();
}

(function () {
  const saved = localStorage.getItem("APPS_SCRIPT_URL");
  if (saved && !CONFIG.APPS_SCRIPT_URL) CONFIG.APPS_SCRIPT_URL = saved;
})();

// ============================================================
// GITHUB ACTIONS — MANUAL REFRESH
// ============================================================

async function triggerScrape(cardName = null) {
  const label = cardName ? `"${cardName}"` : "all cards";
  showToast(`Triggering price refresh for ${label}…`);

  const action = cardName ? "triggerScrapeCard" : "triggerScrape";
  const params = cardName ? { cardName } : {};

  try {
    // Use apiFetch (GET) so we can read the Apps Script response — apiPost
    // uses no-cors and can never read the reply, masking any errors.
    const res = await apiFetch(action, params);
    if (res && res.status === "success") {
      showToast(`Refresh started for ${label}. Check GitHub Actions for progress.`);
    } else {
      showToast((res && res.message) || "Failed to trigger refresh.", "error");
    }
  } catch (err) {
    showToast(`Failed to trigger refresh: ${err.message}`, "error");
  }
}

// ============================================================
// EVENT LISTENERS
// ============================================================

function setupEventListeners() {
  // Inventory search filter
  const searchInput = document.getElementById("search-input");
  if (searchInput) searchInput.addEventListener("input", e => { state.searchQuery = e.target.value; renderTable(); });

  // TCG card search (debounced)
  const tcgInput = document.getElementById("tcg-search-input");
  if (tcgInput) {
    tcgInput.addEventListener("input", e => {
      clearTimeout(state.searchDebounceTimer);
      const val = e.target.value.trim();
      if (!val) { setSearchState("idle"); return; }
      setSearchState("loading");
      state.searchDebounceTimer = setTimeout(() => searchTCGCards(val), 500);
    });
  }

  // Sort headers
  document.querySelectorAll("[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (state.sortColumn === col) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortColumn = col; state.sortDir = "desc"; }
      document.querySelectorAll("[data-sort]").forEach(h => h.classList.remove("sort-asc","sort-desc"));
      th.classList.add("sort-" + state.sortDir);
      renderTable();
    });
  });

  // Portfolio chart range buttons
  document.querySelectorAll(".range-btn:not(.detail-range-btn)").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".range-btn:not(.detail-range-btn)").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.chartRange = btn.dataset.range;
      if (state.chartInstance) { state.chartInstance.destroy(); state.chartInstance = null; }
      renderChart();
    });
  });

  // Detail modal range buttons
  document.querySelectorAll(".detail-range-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".detail-range-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.detailRange = btn.dataset.range;
      const card = state.detailCard;
      if (card && card._priceHistoryData) {
        if (state.priceHistoryChart) { state.priceHistoryChart.destroy(); state.priceHistoryChart = null; }
        if (state.volumeChart)       { state.volumeChart.destroy(); state.volumeChart = null; }
        renderDetailPriceChart(card._priceHistoryData, state.detailRange);
        renderDetailVolumeChart(card._priceHistoryData, state.detailRange);
      }
    });
  });

  // Card form submit
  const form = document.getElementById("card-form");
  if (form) form.addEventListener("submit", submitCardForm);

  // Add/edit modal close on backdrop
  document.getElementById("card-modal").addEventListener("click", e => { if (e.target === e.currentTarget) closeModal(); });

  // Detail modal close on backdrop
  document.getElementById("card-detail-modal").addEventListener("click", e => { if (e.target === e.currentTarget) closeDetailModal(); });

  // Confirm dialog
  document.getElementById("confirm-yes").addEventListener("click", executeDelete);
  document.getElementById("confirm-no").addEventListener("click",  closeConfirm);

  // Update URL button
  const updateUrlBtn = document.getElementById("update-url-btn");
  if (updateUrlBtn) {
    updateUrlBtn.addEventListener("click", () => {
      const newUrl = prompt("Enter your new Apps Script URL:");
      if (newUrl && newUrl.startsWith("https://")) {
        localStorage.setItem("APPS_SCRIPT_URL", newUrl);
        CONFIG.APPS_SCRIPT_URL = newUrl;
        showToast("URL updated. Reloading…");
        setTimeout(loadDashboard, 500);
      }
    });
  }

  // Refresh All Prices button
  const refreshAllBtn = document.getElementById("refresh-all-btn");
  if (refreshAllBtn) refreshAllBtn.addEventListener("click", () => triggerScrape());

  // Refresh This Card button (inside detail modal)
  const refreshCardBtn = document.getElementById("refresh-card-btn");
  if (refreshCardBtn) {
    refreshCardBtn.addEventListener("click", () => {
      const cardName = state.detailCard && state.detailCard["Card Name"];
      if (cardName) triggerScrape(cardName);
    });
  }
}

// ============================================================
// UTILITIES
// ============================================================

function formatCurrency(val, signed = false) {
  const n = parseFloat(val) || 0;
  const prefix = signed && n > 0 ? "+" : "";
  return prefix + new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);
}

function formatPct(val, signed = false) {
  const n = parseFloat(val) || 0;
  return (signed && n > 0 ? "+" : "") + n.toFixed(2) + "%";
}

function escHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
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

function showError(msg)  { showToast(msg, "error"); }

function showToast(msg, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast toast-" + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => { toast.classList.remove("visible"); setTimeout(() => toast.remove(), 300); }, 3500);
}

function updateLastUpdated() {
  const el = document.getElementById("last-updated");
  if (el) el.textContent = "Updated " + new Date().toLocaleTimeString();
}

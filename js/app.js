// ============================================================
// Pokemon Card Portfolio Tracker — Main Application
// ============================================================

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
// API CALLS
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
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...data }),
    mode: "no-cors",
  });
  // no-cors means we can't read the response, so optimistically return success
  return { status: "success" };
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

  // Most valuable card
  const sorted = [...state.inventory].sort(
    (a, b) => (parseFloat(b["Current Price"]) || 0) - (parseFloat(a["Current Price"]) || 0)
  );
  const topCard = sorted[0];
  setText("top-card-name", topCard ? topCard["Card Name"] : "—");
  setText("top-card-value", topCard ? formatCurrency(parseFloat(topCard["Current Price"]) || 0) : "—");

  // Average value
  const avg = state.inventory.length
    ? d.totalValue / state.inventory.length
    : 0;
  setText("avg-card-value", formatCurrency(avg));

  // Invested vs current
  setText("total-invested", formatCurrency(d.totalInvested || 0));
  setText("total-current", formatCurrency(d.totalValue || 0));

  // Best performer (highest gain %)
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

  // Filter
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r["Card Name"] || "").toLowerCase().includes(q) ||
        (r["Set"] || "").toLowerCase().includes(q) ||
        (r["Condition"] || "").toLowerCase().includes(q)
    );
  }

  // Sort
  rows.sort((a, b) => {
    let av = a[state.sortColumn] || "";
    let bv = b[state.sortColumn] || "";
    // Try numeric
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

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">
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

      return `
      <tr data-row="${card._rowIndex}" class="table-row">
        <td>
          <div class="card-name-cell">
            <span class="card-name">${escHtml(card["Card Name"] || "")}</span>
            ${graded ? `<span class="badge-grade">PSA ${escHtml(String(card["PSA Grade"] || ""))}</span>` : ""}
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

  // Filter by range
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

  // Add current value if not already there
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
      datasets: [
        {
          label: "Portfolio Value",
          data: values,
          borderColor: lineColor,
          backgroundColor: lineColor + "22",
          borderWidth: 2.5,
          pointRadius: labels.length > 30 ? 0 : 3,
          pointHoverRadius: 5,
          fill: true,
          tension: 0.3,
        },
      ],
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
          callbacks: {
            label: (ctx) => " " + formatCurrency(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: {
          grid: { color: CONFIG.CHART_COLORS.gridLine },
          ticks: { color: "#888", maxTicksLimit: 8 },
        },
        y: {
          grid: { color: CONFIG.CHART_COLORS.gridLine },
          ticks: {
            color: "#888",
            callback: (v) => formatCurrency(v),
          },
        },
      },
    },
  });
}

// ============================================================
// MODAL — ADD / EDIT CARD
// ============================================================

function openAddModal() {
  state.editingRowIndex = null;
  document.getElementById("modal-title").textContent = "Add Card";
  document.getElementById("card-form").reset();
  document.getElementById("card-modal").classList.add("open");
}

function openEditModal(rowIndex) {
  const card = state.inventory.find((c) => c._rowIndex === rowIndex);
  if (!card) return;
  state.editingRowIndex = rowIndex;
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
  fillFormField("field-notes", card["Notes"]);
  document.getElementById("field-date-added").value = card["Date Added"] || "";

  document.getElementById("card-modal").classList.add("open");
}

function closeModal() {
  document.getElementById("card-modal").classList.remove("open");
  state.editingRowIndex = null;
}

async function submitCardForm(e) {
  e.preventDefault();
  const btn = document.getElementById("form-submit-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  const data = {
    cardName: getFormVal("field-name"),
    set: getFormVal("field-set"),
    cardNumber: getFormVal("field-number"),
    condition: getFormVal("field-condition"),
    quantity: getFormVal("field-qty"),
    graded: document.getElementById("field-graded").checked,
    psaGrade: getFormVal("field-psa"),
    purchasePrice: getFormVal("field-purchase-price"),
    currentPrice: getFormVal("field-current-price"),
    priceChartingUrl: getFormVal("field-url"),
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
  // Save to localStorage for persistence
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
  // Search
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      renderTable();
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

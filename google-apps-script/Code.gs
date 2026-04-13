// Pokemon Card Portfolio Tracker - Google Apps Script
// Paste this entire file into your Google Sheets Apps Script editor

var SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// ============================================================
// SHEET SETUP
// ============================================================

function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // Inventory tab
  if (!ss.getSheetByName("Inventory")) {
    var inv = ss.insertSheet("Inventory");
    inv.appendRow([
      "Row", "Card Name", "Set", "Card Number", "Condition", "Quantity",
      "Graded", "PSA Grade", "Purchase Price", "Purchase Date", "Current Price", "Total Value",
      "PriceCharting URL", "Date Added", "Notes", "Image URL"
    ]);
    inv.getRange(1, 1, 1, 16).setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
    inv.setFrozenRows(1);
  }

  // Price History tab
  if (!ss.getSheetByName("Price History")) {
    var ph = ss.insertSheet("Price History");
    ph.appendRow(["Timestamp", "Card Name", "Set", "Card Number", "Price (USD)", "Source"]);
    ph.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
    ph.setFrozenRows(1);
  }

  // Portfolio Snapshots tab
  if (!ss.getSheetByName("Portfolio Snapshots")) {
    var ps = ss.insertSheet("Portfolio Snapshots");
    ps.appendRow([
      "Date", "Total Cards", "Total Portfolio Value",
      "Daily Change ($)", "Daily Change (%)", "Highest Value Card"
    ]);
    ps.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
    ps.setFrozenRows(1);
  }

  // Settings tab
  if (!ss.getSheetByName("Settings")) {
    var set = ss.insertSheet("Settings");
    set.appendRow(["Key", "Value"]);
    set.appendRow(["Last Scrape Date", ""]);
    set.appendRow(["Currency", "USD"]);
    set.appendRow(["Portfolio Name", "My Pokemon Collection"]);
    set.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
  }

  return { status: "success", message: "Sheet setup complete" };
}

// ============================================================
// CORS HEADERS
// ============================================================

function addCorsHeaders(output) {
  return output
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonResponse(data) {
  var output = ContentService.createTextOutput(JSON.stringify(data));
  return addCorsHeaders(output);
}

// ============================================================
// doGet — READ ENDPOINTS
// ============================================================

function doGet(e) {
  try {
    var action = e.parameter.action || "getDashboard";

    switch (action) {
      case "getInventory":
        return jsonResponse(getInventory());
      case "getPriceHistory":
        return jsonResponse(getPriceHistory(e.parameter));
      case "getPortfolio":
        return jsonResponse(getPortfolioSnapshots());
      case "getDashboard":
        return jsonResponse(getDashboard());
      case "setup":
        return jsonResponse(setupSheet());
      default:
        return jsonResponse({ status: "error", message: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function getInventory() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Inventory");
  if (!sheet) return { status: "error", message: "Inventory sheet not found. Run setup first." };

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { status: "success", data: [] };

  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    row["_rowIndex"] = i + 1; // 1-based sheet row number
    rows.push(row);
  }
  return { status: "success", data: rows };
}

function getPriceHistory(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Price History");
  if (!sheet) return { status: "error", message: "Price History sheet not found." };

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { status: "success", data: [] };

  var headers = data[0];
  var rows = [];
  var cardFilter = params && params.cardName ? params.cardName.toLowerCase() : null;

  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    if (!cardFilter || (row["Card Name"] && row["Card Name"].toLowerCase().indexOf(cardFilter) !== -1)) {
      rows.push(row);
    }
  }
  return { status: "success", data: rows };
}

function getPortfolioSnapshots() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Portfolio Snapshots");
  if (!sheet) return { status: "error", message: "Portfolio Snapshots sheet not found." };

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { status: "success", data: [] };

  var headers = data[0];
  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = {};
    for (var j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }
  return { status: "success", data: rows };
}

function getDashboard() {
  var inventory = getInventory();
  var snapshots = getPortfolioSnapshots();

  var totalValue = 0;
  var totalCards = 0;
  var highestCard = null;
  var totalInvested = 0;

  if (inventory.status === "success") {
    inventory.data.forEach(function(card) {
      var qty = parseFloat(card["Quantity"]) || 1;
      var price = parseFloat(card["Current Price"]) || 0;
      var purchase = parseFloat(card["Purchase Price"]) || 0;
      totalValue += price * qty;
      totalInvested += purchase * qty;
      totalCards += qty;
      if (!highestCard || price > parseFloat(highestCard["Current Price"])) {
        highestCard = card;
      }
    });
  }

  // Calculate daily change from last two snapshots
  var dailyChange = 0;
  var dailyChangePct = 0;
  if (snapshots.status === "success" && snapshots.data.length >= 2) {
    var last = snapshots.data[snapshots.data.length - 1];
    var prev = snapshots.data[snapshots.data.length - 2];
    dailyChange = (parseFloat(last["Total Portfolio Value"]) || 0) - (parseFloat(prev["Total Portfolio Value"]) || 0);
    var prevVal = parseFloat(prev["Total Portfolio Value"]) || 0;
    dailyChangePct = prevVal !== 0 ? (dailyChange / prevVal) * 100 : 0;
  }

  return {
    status: "success",
    data: {
      totalValue: totalValue,
      totalCards: totalCards,
      totalInvested: totalInvested,
      unrealizedGain: totalValue - totalInvested,
      unrealizedGainPct: totalInvested !== 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0,
      dailyChange: dailyChange,
      dailyChangePct: dailyChangePct,
      highestValueCard: highestCard,
      inventory: inventory.data,
      snapshots: snapshots.data
    }
  };
}

// ============================================================
// doPost — WRITE ENDPOINTS
// ============================================================

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;

    switch (action) {
      case "addCard":
        return jsonResponse(addCard(body.data));
      case "updateCard":
        return jsonResponse(updateCard(body.rowIndex, body.data));
      case "deleteCard":
        return jsonResponse(deleteCard(body.rowIndex));
      case "updatePrices":
        return jsonResponse(updatePrices(body.data));
      case "addSnapshot":
        return jsonResponse(addSnapshot(body.data));
      default:
        return jsonResponse({ status: "error", message: "Unknown action: " + action });
    }
  } catch (err) {
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function addCard(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Inventory");
  if (!sheet) return { status: "error", message: "Inventory sheet not found. Run setup first." };

  var lastRow = sheet.getLastRow();
  var rowNum = lastRow; // row number for display (excludes header)

  var now = new Date();
  var dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");

  var totalValue = (parseFloat(data.currentPrice) || 0) * (parseFloat(data.quantity) || 1);

  var row = [
    rowNum,
    data.cardName || "",
    data.set || "",
    data.cardNumber || "",
    data.condition || "NM",
    parseFloat(data.quantity) || 1,
    data.graded === true || data.graded === "true" ? "Yes" : "No",
    data.psaGrade || "",
    parseFloat(data.purchasePrice) || 0,
    data.purchaseDate || "",
    parseFloat(data.currentPrice) || 0,
    totalValue,
    data.priceChartingUrl || "",
    dateStr,
    data.notes || "",
    data.imageUrl || ""
  ];

  sheet.appendRow(row);
  return { status: "success", message: "Card added", rowIndex: sheet.getLastRow() };
}

function updateCard(rowIndex, data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Inventory");
  if (!sheet) return { status: "error", message: "Inventory sheet not found." };

  var ri = parseInt(rowIndex);
  if (!ri || ri < 2) return { status: "error", message: "Invalid row index" };

  var totalValue = (parseFloat(data.currentPrice) || 0) * (parseFloat(data.quantity) || 1);

  var row = [
    ri - 1, // Row display number
    data.cardName || "",
    data.set || "",
    data.cardNumber || "",
    data.condition || "NM",
    parseFloat(data.quantity) || 1,
    data.graded === true || data.graded === "true" ? "Yes" : "No",
    data.psaGrade || "",
    parseFloat(data.purchasePrice) || 0,
    data.purchaseDate || "",
    parseFloat(data.currentPrice) || 0,
    totalValue,
    data.priceChartingUrl || "",
    data.dateAdded || "",
    data.notes || "",
    data.imageUrl || ""
  ];

  sheet.getRange(ri, 1, 1, row.length).setValues([row]);
  return { status: "success", message: "Card updated", rowIndex: ri };
}

function deleteCard(rowIndex) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Inventory");
  if (!sheet) return { status: "error", message: "Inventory sheet not found." };

  var ri = parseInt(rowIndex);
  if (!ri || ri < 2) return { status: "error", message: "Invalid row index" };

  sheet.deleteRow(ri);
  return { status: "success", message: "Card deleted" };
}

function updatePrices(priceUpdates) {
  // priceUpdates = [{ rowIndex, currentPrice }, ...]
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Inventory");
  var histSheet = ss.getSheetByName("Price History");
  if (!sheet) return { status: "error", message: "Inventory sheet not found." };

  var updated = 0;
  var now = new Date();
  var timestamp = Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");

  priceUpdates.forEach(function(update) {
    var ri = parseInt(update.rowIndex);
    if (!ri || ri < 2) return;

    var rowData = sheet.getRange(ri, 1, 1, 14).getValues()[0];
    var qty = parseFloat(rowData[5]) || 1;
    var newPrice = parseFloat(update.currentPrice) || 0;
    var totalValue = newPrice * qty;

    // Update Current Price and Total Value columns (cols 11 and 12)
    sheet.getRange(ri, 11).setValue(newPrice);
    sheet.getRange(ri, 12).setValue(totalValue);

    // Log to Price History
    if (histSheet) {
      histSheet.appendRow([
        timestamp,
        rowData[1], // Card Name
        rowData[2], // Set
        rowData[3], // Card Number
        newPrice,
        "PriceCharting"
      ]);
    }
    updated++;
  });

  // Update last scrape date in Settings
  var settingsSheet = ss.getSheetByName("Settings");
  if (settingsSheet) {
    var settingsData = settingsSheet.getDataRange().getValues();
    for (var i = 1; i < settingsData.length; i++) {
      if (settingsData[i][0] === "Last Scrape Date") {
        settingsSheet.getRange(i + 1, 2).setValue(timestamp);
        break;
      }
    }
  }

  return { status: "success", message: "Updated " + updated + " prices" };
}

function addSnapshot(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Portfolio Snapshots");
  if (!sheet) return { status: "error", message: "Portfolio Snapshots sheet not found." };

  var now = new Date();
  var dateStr = data.date || Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd");

  sheet.appendRow([
    dateStr,
    parseInt(data.totalCards) || 0,
    parseFloat(data.totalValue) || 0,
    parseFloat(data.dailyChange) || 0,
    parseFloat(data.dailyChangePct) || 0,
    data.highestValueCard || ""
  ]);

  return { status: "success", message: "Snapshot added" };
}

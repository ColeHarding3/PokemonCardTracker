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

  // Card Price History tab
  if (!ss.getSheetByName("Card Price History")) {
    var cph = ss.insertSheet("Card Price History");
    cph.appendRow(["Card Name", "Set", "Card Number", "Condition Type", "Date", "Price", "Volume"]);
    cph.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
    cph.setFrozenRows(1);
  }

  // PSA Population tab
  if (!ss.getSheetByName("PSA Population")) {
    var psaPop = ss.insertSheet("PSA Population");
    psaPop.appendRow(["Card Name", "Set", "Card Number", "PSA 9 Pop", "PSA 10 Pop", "Last Updated"]);
    psaPop.getRange(1, 1, 1, 6).setFontWeight("bold").setBackground("#1a1a2e").setFontColor("#ffffff");
    psaPop.setFrozenRows(1);
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
      case "getCardPriceHistory":
        return jsonResponse(getCardPriceHistoryData(e.parameter));
      case "getAllPriceHistory":
        return jsonResponse(getAllPriceHistoryData());
      case "triggerScrape":
        return jsonResponse(triggerGitHubScrape(null));
      case "triggerScrapeCard":
        return jsonResponse(triggerGitHubScrape(e.parameter.cardName || null));
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

  var headers = data[0].slice(); // copy so we can patch without mutating sheet data
  // Migration safety: if the sheet predates the Image URL column, col 16 header is
  // an empty string but the data rows may still have a URL there (written by addCard).
  // Map it correctly so card["Image URL"] is never undefined on the frontend.
  var EXPECTED_HEADERS = [
    "Row", "Card Name", "Set", "Card Number", "Condition", "Quantity",
    "Graded", "PSA Grade", "Purchase Price", "Purchase Date", "Current Price",
    "Total Value", "PriceCharting URL", "Date Added", "Notes", "Image URL"
  ];
  for (var k = 0; k < EXPECTED_HEADERS.length; k++) {
    if (!headers[k]) headers[k] = EXPECTED_HEADERS[k];
  }

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
  var psaPopMap = getPsaPopulationData();

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
      snapshots: snapshots.data,
      psaPopulation: psaPopMap
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
      case "updatePriceHistory":
        return jsonResponse(updateCardPriceHistory(body));
      case "updatePsaPopulation":
        return jsonResponse(updatePsaPopulation(body));
      case "updateImageUrls":
        return jsonResponse(updateImageUrls(body.data));
      case "updatePriceChartingUrls":
        return jsonResponse(updatePriceChartingUrls(body.data));
      case "triggerScrape":
        return jsonResponse(triggerGitHubScrape(null));
      case "triggerScrapeCard":
        return jsonResponse(triggerGitHubScrape(body.cardName || null));
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

// ============================================================
// CARD PRICE HISTORY — new tab (Card Price History)
// ============================================================

function updateCardPriceHistory(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Card Price History");
  if (!sheet) return { status: "error", message: "Card Price History sheet not found. Run setup first." };

  var cardName   = body.cardName   || "";
  var set        = body.set        || "";
  var cardNumber = body.cardNumber || "";
  var history    = body.history    || {};  // { ungraded: [...], psa9: [...], psa10: [...] }

  // Delete existing rows for this card (scan bottom-to-top to avoid index shifting)
  var lastRow = sheet.getLastRow();
  for (var i = lastRow; i >= 2; i--) {
    var rowVals = sheet.getRange(i, 1, 1, 3).getValues()[0];
    if (rowVals[0] === cardName && rowVals[1] === set) {
      sheet.deleteRow(i);
    }
  }

  // Write new rows
  var conditionTypes = ["ungraded", "psa9", "psa10"];
  var rowsToAdd = [];
  conditionTypes.forEach(function(condType) {
    var points = history[condType] || [];
    points.forEach(function(pt) {
      rowsToAdd.push([
        cardName,
        set,
        cardNumber,
        condType,
        pt.date  || "",
        parseFloat(pt.price)  || 0,
        pt.volume != null ? parseInt(pt.volume) : ""
      ]);
    });
  });

  if (rowsToAdd.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAdd.length, 7).setValues(rowsToAdd);
    // Force the Date column (col 5) to plain text so Sheets doesn't
    // auto-convert "2025-01" strings into Date objects on read-back.
    sheet.getRange(2, 5, sheet.getLastRow() - 1, 1).setNumberFormat("@");
  }

  return { status: "success", message: "Price history updated: " + rowsToAdd.length + " rows" };
}

// Sheets auto-converts "YYYY-MM" strings to Date objects; normalise back to "YYYY-MM".
function normaliseDateCell(raw) {
  if (raw instanceof Date) {
    var yr = raw.getFullYear();
    var mo = ("0" + (raw.getMonth() + 1)).slice(-2);
    return yr + "-" + mo;
  }
  return raw.toString();
}

function getCardPriceHistoryData(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Card Price History");
  if (!sheet) return { status: "success", data: { ungraded: [], psa9: [], psa10: [] } };

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { status: "success", data: { ungraded: [], psa9: [], psa10: [] } };

  var filterName = (params && params.cardName) ? params.cardName.toLowerCase() : null;
  var filterSet  = (params && params.set)      ? params.set.toLowerCase()      : null;

  var result = { ungraded: [], psa9: [], psa10: [] };
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    // columns: Card Name(0) Set(1) Card Number(2) Condition Type(3) Date(4) Price(5) Volume(6)
    if (filterName && row[0].toString().toLowerCase() !== filterName) continue;
    if (filterSet  && row[1].toString().toLowerCase() !== filterSet)  continue;
    var condType = row[3].toString();
    if (!result[condType]) continue;
    result[condType].push({
      date:   normaliseDateCell(row[4]),
      price:  parseFloat(row[5]) || 0,
      volume: row[6] !== "" ? parseInt(row[6]) : null
    });
  }

  // Sort each condition by date
  ["ungraded", "psa9", "psa10"].forEach(function(k) {
    result[k].sort(function(a, b) { return a.date < b.date ? -1 : 1; });
  });

  return { status: "success", data: result };
}

function getAllPriceHistoryData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Card Price History");
  if (!sheet) return { status: "success", data: [] };

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return { status: "success", data: [] };

  var rows = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    rows.push({
      cardName:      row[0].toString(),
      set:           row[1].toString(),
      cardNumber:    row[2].toString(),
      conditionType: row[3].toString(),
      date:          normaliseDateCell(row[4]),
      price:         parseFloat(row[5]) || 0,
      volume:        row[6] !== "" ? parseInt(row[6]) : null
    });
  }
  return { status: "success", data: rows };
}

// ============================================================
// PSA POPULATION
// ============================================================

function updatePsaPopulation(body) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("PSA Population");
  if (!sheet) return { status: "error", message: "PSA Population sheet not found. Run setup first." };

  var cardName   = body.cardName   || "";
  var set        = body.set        || "";
  var cardNumber = body.cardNumber || "";
  var psa9Pop    = body.psa9Pop  != null ? parseInt(body.psa9Pop)  : "";
  var psa10Pop   = body.psa10Pop != null ? parseInt(body.psa10Pop) : "";
  var timestamp  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");

  // Find existing row for this card
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === cardName && data[i][1] === set) {
      sheet.getRange(i + 1, 4, 1, 3).setValues([[psa9Pop, psa10Pop, timestamp]]);
      return { status: "success", message: "PSA population updated" };
    }
  }

  // New row
  sheet.appendRow([cardName, set, cardNumber, psa9Pop, psa10Pop, timestamp]);
  return { status: "success", message: "PSA population added" };
}

// ============================================================
// GITHUB ACTIONS TRIGGER
// ============================================================

function triggerGitHubScrape(cardName) {
  var token = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");
  if (!token) {
    return { status: "error", message: "GITHUB_TOKEN script property not set. See SETUP.md for instructions." };
  }

  var url = "https://api.github.com/repos/Coleharding3/pokemoncardtracker/actions/workflows/scrape.yml/dispatches";
  var payload = { ref: "main" };
  if (cardName) {
    payload.inputs = { card_name: cardName };
  }

  var options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();

  if (code === 204) {
    return { status: "success", message: cardName ? "Scrape triggered for: " + cardName : "Full scrape triggered" };
  } else {
    var body = "";
    try { body = JSON.parse(response.getContentText()).message; } catch (e) {}
    return { status: "error", message: "GitHub API error " + code + (body ? ": " + body : "") };
  }
}

// ============================================================
// PRICECHARTING URL UPDATE
// ============================================================

function updatePriceChartingUrls(updates) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Inventory");
  if (!sheet) return { status: "error", message: "Inventory sheet not found." };

  if (!updates || !updates.length) return { status: "success", message: "No updates" };

  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 0; i < updates.length; i++) {
    var url = updates[i].url || "";
    if (!url) continue;
    var rowIndex = parseInt(updates[i].rowIndex);
    if (!rowIndex || rowIndex < 2) {
      rowIndex = findRowByNameSet_(data, updates[i].cardName, updates[i].set);
    }
    if (!rowIndex) continue;
    sheet.getRange(rowIndex, 13).setValue(url); // col 13 = PriceCharting URL
    count++;
  }
  return { status: "success", message: "Updated " + count + " PriceCharting URL(s)" };
}

// ============================================================
// IMAGE URL UPDATE
// ============================================================

function updateImageUrls(updates) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Inventory");
  if (!sheet) return { status: "error", message: "Inventory sheet not found." };

  if (!updates || !updates.length) return { status: "success", message: "No updates" };

  var data = sheet.getDataRange().getValues();
  var count = 0;
  for (var i = 0; i < updates.length; i++) {
    var imageUrl = updates[i].imageUrl || "";
    var rowIndex = parseInt(updates[i].rowIndex);
    if (!rowIndex || rowIndex < 2) {
      rowIndex = findRowByNameSet_(data, updates[i].cardName, updates[i].set);
    }
    if (!rowIndex) continue;
    sheet.getRange(rowIndex, 16).setValue(imageUrl); // col 16 = Image URL
    count++;
  }
  return { status: "success", message: "Updated " + count + " image URL(s)" };
}

function findRowByNameSet_(data, cardName, cardSet) {
  if (!cardName) return null;
  cardName = cardName.toString().toLowerCase().trim();
  cardSet = (cardSet || "").toString().toLowerCase().trim();
  for (var r = 1; r < data.length; r++) {
    var name = (data[r][1] || "").toString().toLowerCase().trim(); // col B
    var set  = (data[r][2] || "").toString().toLowerCase().trim(); // col C
    if (name === cardName && set === cardSet) return r + 1; // 1-indexed sheet row
  }
  return null;
}

function getPsaPopulationData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("PSA Population");
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0] + "|||" + data[i][1];
    map[key] = {
      cardName:   data[i][0].toString(),
      set:        data[i][1].toString(),
      psa9Pop:    data[i][3] !== "" ? parseInt(data[i][3]) : null,
      psa10Pop:   data[i][4] !== "" ? parseInt(data[i][4]) : null,
      lastUpdated: data[i][5].toString()
    };
  }
  return map;
}

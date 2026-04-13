#!/usr/bin/env python3
"""
Pokemon Card Portfolio Tracker — Price Scraper
Fetches current prices from pricecharting.com and updates Google Sheets.
"""

import os
import sys
import json
import time
import logging
import requests
from datetime import date
from urllib.parse import quote_plus, urljoin
from bs4 import BeautifulSoup

# ============================================================
# CONFIG
# ============================================================

APPS_SCRIPT_URL = os.environ.get("APPS_SCRIPT_URL", "")
REQUEST_DELAY   = 2.0   # seconds between requests (be polite)
REQUEST_TIMEOUT = 15    # seconds before giving up on a request

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

PRICECHARTING_BASE = "https://www.pricecharting.com"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ============================================================
# API HELPERS
# ============================================================

def api_get(action: str, params: dict = None) -> dict:
    """Call the Apps Script GET endpoint."""
    if not APPS_SCRIPT_URL:
        raise RuntimeError("APPS_SCRIPT_URL environment variable is not set.")
    url_params = {"action": action}
    if params:
        url_params.update(params)
    resp = requests.get(APPS_SCRIPT_URL, params=url_params, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()


def api_post(action: str, payload: dict) -> dict:
    """Call the Apps Script POST endpoint."""
    if not APPS_SCRIPT_URL:
        raise RuntimeError("APPS_SCRIPT_URL environment variable is not set.")
    body = {"action": action, **payload}
    resp = requests.post(
        APPS_SCRIPT_URL,
        data=json.dumps(body),
        headers={**HEADERS, "Content-Type": "text/plain"},
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    # Apps Script may return empty body with no-cors; handle gracefully
    try:
        return resp.json()
    except ValueError:
        return {"status": "success", "message": "No JSON response (no-cors mode)"}

# ============================================================
# PRICE FETCHING
# ============================================================

def fetch_price_from_url(url: str) -> float | None:
    """
    Fetch price from a specific PriceCharting product URL.
    Returns the 'loose' / ungraded price as a float, or None on failure.
    """
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # PriceCharting shows price in #used_price or .price elements
        selectors = [
            "#used_price .price",
            "#complete_price .price",
            "#new_price .price",
            ".price-box .price",
        ]
        for sel in selectors:
            el = soup.select_one(sel)
            if el:
                price_text = el.get_text(strip=True).replace("$", "").replace(",", "")
                try:
                    price = float(price_text)
                    if price > 0:
                        return price
                except ValueError:
                    continue

        log.warning("Could not extract price from %s", url)
        return None

    except requests.RequestException as e:
        log.error("Network error fetching %s: %s", url, e)
        return None


def search_pricecharting(card_name: str, set_name: str = "") -> tuple[str | None, float | None]:
    """
    Search PriceCharting for a card and return (product_url, price).
    Returns (None, None) if not found.
    """
    query = f"{card_name} {set_name}".strip()
    search_url = f"{PRICECHARTING_BASE}/search-products?q={quote_plus(query)}&type=pokemon"

    try:
        resp = requests.get(search_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # First search result link
        result = soup.select_one("table.results td.title a")
        if not result:
            # Try alternate selector
            result = soup.select_one(".search-result a")

        if not result:
            log.warning("No PriceCharting result for '%s'", query)
            return None, None

        product_url = urljoin(PRICECHARTING_BASE, result["href"])
        log.info("  Found: %s", product_url)

        time.sleep(REQUEST_DELAY)
        price = fetch_price_from_url(product_url)
        return product_url, price

    except requests.RequestException as e:
        log.error("Search error for '%s': %s", query, e)
        return None, None

# ============================================================
# MAIN SCRAPER LOGIC
# ============================================================

def scrape_all():
    log.info("=" * 60)
    log.info("Pokemon Card Portfolio Scraper starting")
    log.info("=" * 60)

    # 1. Fetch inventory
    log.info("Fetching inventory from Google Sheets…")
    try:
        result = api_get("getInventory")
    except Exception as e:
        log.error("Failed to fetch inventory: %s", e)
        sys.exit(1)

    if result.get("status") != "success":
        log.error("API error: %s", result.get("message"))
        sys.exit(1)

    inventory = result.get("data", [])
    if not inventory:
        log.info("Inventory is empty. Nothing to scrape.")
        sys.exit(0)

    log.info("Found %d cards in inventory.", len(inventory))

    # 2. Scrape prices
    price_updates   = []
    total_value     = 0.0
    total_cards     = 0
    highest_card    = None
    highest_price   = 0.0

    for card in inventory:
        name      = card.get("Card Name", "Unknown")
        set_name  = card.get("Set", "")
        url       = card.get("PriceCharting URL", "").strip()
        row_index = card.get("_rowIndex")
        qty       = float(card.get("Quantity") or 1)

        log.info("Processing: %s (%s)…", name, set_name)

        price = None
        found_url = url

        if url:
            time.sleep(REQUEST_DELAY)
            price = fetch_price_from_url(url)
            if price is None:
                log.warning("  Could not fetch price from saved URL, trying search…")

        if price is None:
            time.sleep(REQUEST_DELAY)
            found_url, price = search_pricecharting(name, set_name)

        if price is not None:
            log.info("  → $%.2f", price)
            update = {"rowIndex": row_index, "currentPrice": price}
            if found_url and found_url != url:
                update["priceChartingUrl"] = found_url
            price_updates.append(update)
            total_value += price * qty
            total_cards += int(qty)
            if price > highest_price:
                highest_price = price
                highest_card  = name
        else:
            log.warning("  → No price found, skipping.")
            current = float(card.get("Current Price") or 0)
            total_value += current * qty
            total_cards += int(qty)

    # 3. Push price updates
    if price_updates:
        log.info("Pushing %d price updates to Google Sheets…", len(price_updates))
        try:
            res = api_post("updatePrices", {"data": price_updates})
            log.info("  Response: %s", res.get("message", res))
        except Exception as e:
            log.error("Failed to push prices: %s", e)
    else:
        log.warning("No price updates to push.")

    # 4. Fetch previous snapshot for daily change calc
    daily_change     = 0.0
    daily_change_pct = 0.0
    try:
        snap_result = api_get("getPortfolio")
        snaps = snap_result.get("data", [])
        if snaps:
            prev_val = float(snaps[-1].get("Total Portfolio Value") or 0)
            daily_change = total_value - prev_val
            daily_change_pct = (daily_change / prev_val * 100) if prev_val else 0.0
    except Exception as e:
        log.warning("Could not fetch previous snapshots: %s", e)

    # 5. Add portfolio snapshot
    today = date.today().isoformat()
    log.info("Adding portfolio snapshot for %s: $%.2f", today, total_value)
    try:
        res = api_post("addSnapshot", {
            "data": {
                "date":           today,
                "totalCards":     total_cards,
                "totalValue":     round(total_value, 2),
                "dailyChange":    round(daily_change, 2),
                "dailyChangePct": round(daily_change_pct, 4),
                "highestValueCard": highest_card or "",
            }
        })
        log.info("  Response: %s", res.get("message", res))
    except Exception as e:
        log.error("Failed to add snapshot: %s", e)

    log.info("=" * 60)
    log.info("Scrape complete. Total portfolio value: $%.2f", total_value)
    log.info("=" * 60)


if __name__ == "__main__":
    if not APPS_SCRIPT_URL:
        log.error("APPS_SCRIPT_URL environment variable is not set.")
        log.error("Set it with: export APPS_SCRIPT_URL='https://script.google.com/...'")
        sys.exit(1)
    scrape_all()

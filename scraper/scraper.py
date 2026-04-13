#!/usr/bin/env python3
"""
Pokemon Card Portfolio Tracker — Full History Scraper
Extracts monthly price history, volume, and PSA population from pricecharting.com
using VGPC.chart_data and VGPC.pop_data embedded in each product page.
"""

import os
import sys
import json
import time
import re
import logging
import requests
from datetime import datetime, timezone, date
from pathlib import Path
from urllib.parse import quote_plus, urljoin
from bs4 import BeautifulSoup

# ============================================================
# CONFIG
# ============================================================

APPS_SCRIPT_URL  = os.environ.get("APPS_SCRIPT_URL", "")
CARD_NAME        = os.environ.get("CARD_NAME", "").strip()   # if set, only scrape this card
REQUEST_DELAY    = 2.5   # seconds between page fetches — be polite
REQUEST_TIMEOUT  = 20

GITHUB_PAGES_BASE = "https://coleharding3.github.io/PokemonCardTracker"
# Anchor to the repo root (two levels up from scraper/) so the path is correct
# regardless of which directory the script is invoked from.
IMAGES_DIR        = Path(__file__).resolve().parent.parent / "images" / "cards"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

PRICECHARTING_BASE = "https://www.pricecharting.com"

# VGPC.chart_data key → our condition type
CHART_KEY_MAP = {
    "used":       "ungraded",
    "graded":     "psa9",
    "manualonly": "psa10",
}

# completed-auctions div class → our condition type
AUCTION_CLASS_MAP = {
    "completed-auctions-used":        "ungraded",
    "completed-auctions-graded":      "psa9",
    "completed-auctions-manual-only": "psa10",
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ============================================================
# APPS SCRIPT API
# ============================================================

def api_get(session, action, params=None):
    if not APPS_SCRIPT_URL:
        raise RuntimeError("APPS_SCRIPT_URL not set")
    p = {"action": action}
    if params:
        p.update(params)
    resp = session.get(APPS_SCRIPT_URL, params=p, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.json()

def api_post(session, action, payload):
    if not APPS_SCRIPT_URL:
        raise RuntimeError("APPS_SCRIPT_URL not set")
    body = {"action": action, **payload}
    resp = session.post(
        APPS_SCRIPT_URL,
        data=json.dumps(body),
        headers={**HEADERS, "Content-Type": "text/plain"},
        timeout=REQUEST_TIMEOUT,
    )
    try:
        return resp.json()
    except ValueError:
        return {"status": "success"}

# ============================================================
# JS OBJECT EXTRACTION
# ============================================================

def extract_js_object(text, var_name):
    """
    Robustly extract a JSON object or array from a JS variable assignment.
    Handles nested braces/brackets correctly.
    """
    pattern = re.escape(var_name) + r"\s*=\s*"
    m = re.search(pattern, text)
    if not m:
        return None
    start = m.end()
    # Skip leading whitespace
    while start < len(text) and text[start] in " \t\n\r":
        start += 1
    if start >= len(text) or text[start] not in "{[":
        return None

    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_string = False
    escape_next = False

    for i in range(start, len(text)):
        ch = text[i]
        if escape_next:
            escape_next = False
            continue
        if ch == "\\" and in_string:
            escape_next = True
            continue
        if ch == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError:
                    return None
    return None

# ============================================================
# PRODUCT ID EXTRACTION
# ============================================================

def get_product_id(soup, page_text):
    """
    Extract PriceCharting's numeric product ID.
    Tries: data-product-id attr → VGPC.product.id → generic patterns.
    """
    # Method 1: data-product-id attribute (most reliable)
    el = soup.find(attrs={"data-product-id": True})
    if el:
        val = str(el.get("data-product-id", ""))
        if val.isdigit():
            return val

    # Method 2: VGPC.product object
    m = re.search(r"VGPC\.product\s*=\s*\{[^}]*\bid\s*:\s*(\d+)", page_text)
    if m:
        return m.group(1)

    # Method 3: fallback patterns
    for pat in [
        r'"id"\s*:\s*(\d{5,})',
        r"product_id\s*[=:]\s*[\"']?(\d+)",
        r"/api/product/(\d+)/",
    ]:
        m = re.search(pat, page_text)
        if m:
            return m.group(1)

    return None

# ============================================================
# PRICE HISTORY PARSING
# ============================================================

def ts_ms_to_month(ts_ms):
    """Convert millisecond epoch timestamp to 'YYYY-MM'."""
    try:
        dt = datetime.fromtimestamp(int(ts_ms) / 1000, tz=timezone.utc)
        return dt.strftime("%Y-%m")
    except (ValueError, OSError, TypeError):
        return None

def parse_chart_data(chart_data):
    """
    Convert VGPC.chart_data into our three-condition price history format.
    PriceCharting stores prices in cents as integers.
    Returns {'ungraded': [...], 'psa9': [...], 'psa10': [...]}
    """
    result = {"ungraded": [], "psa9": [], "psa10": []}
    if not isinstance(chart_data, dict):
        return result

    for pc_key, our_key in CHART_KEY_MAP.items():
        points = chart_data.get(pc_key, [])
        if not points:
            continue

        monthly = {}  # month -> latest non-zero price in USD
        for point in points:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            ts_ms, price_raw = point[0], point[1]
            if ts_ms is None or price_raw is None:
                continue
            month = ts_ms_to_month(ts_ms)
            if not month:
                continue
            price_cents = int(price_raw) if isinstance(price_raw, (int, float)) else 0
            price_usd = price_cents / 100.0
            if price_usd > 0:
                monthly[month] = price_usd  # keep latest within month

        result[our_key] = [
            {"date": k, "price": round(v, 2), "volume": None}
            for k, v in sorted(monthly.items())
        ]

    return result

# ============================================================
# VOLUME EXTRACTION FROM COMPLETED SALES
# ============================================================

def extract_volume(soup):
    """
    Count completed sales by month per condition from the completed-auctions tables.
    Returns {'ungraded': {'2024-01': 5, ...}, 'psa9': {...}, 'psa10': {...}}
    """
    volumes = {"ungraded": {}, "psa9": {}, "psa10": {}}

    for div_class, our_key in AUCTION_CLASS_MAP.items():
        container = soup.find("div", class_=div_class)
        if not container:
            continue
        for row in container.find_all("tr"):
            date_td = row.find("td", class_="date")
            if not date_td:
                continue
            date_str = date_td.get_text(strip=True)
            if len(date_str) >= 7:
                month = date_str[:7]
                volumes[our_key][month] = volumes[our_key].get(month, 0) + 1

    return volumes

def apply_volume(price_history, volumes):
    """Merge monthly volume counts into price history data points."""
    for cond_key in ("ungraded", "psa9", "psa10"):
        vols = volumes.get(cond_key, {})
        for pt in price_history.get(cond_key, []):
            month = pt.get("date")
            if month and month in vols:
                pt["volume"] = vols[month]
    return price_history

# ============================================================
# PSA POPULATION PARSING
# ============================================================

def parse_psa_pop(pop_data):
    """
    Extract PSA 9 and PSA 10 population from VGPC.pop_data.
    pop_data.psa is a 10-element array; index = grade - 1.
    """
    if not isinstance(pop_data, dict):
        return {"psa9": None, "psa10": None}
    psa = pop_data.get("psa", [])
    if len(psa) >= 10:
        return {
            "psa9":  int(psa[8]),  # grade 9 = index 8
            "psa10": int(psa[9]),  # grade 10 = index 9
        }
    return {"psa9": None, "psa10": None}

# ============================================================
# CURRENT PRICE EXTRACTION (FALLBACK)
# ============================================================

def extract_current_price(soup):
    """Scrape the visible current price from the page as a fallback."""
    for sel in ["#used_price .price", "#price", ".price"]:
        tag = soup.select_one(sel)
        if tag:
            txt = tag.get_text(strip=True).replace("$", "").replace(",", "")
            try:
                return float(txt)
            except ValueError:
                continue
    return None

# ============================================================
# PRICECHARTING URL FINDER
# ============================================================

def find_pricecharting_url(session, card_name, card_set=""):
    """Search pricecharting.com for a card and return the product URL."""
    query = f"{card_name} {card_set}".strip()
    search_url = f"{PRICECHARTING_BASE}/search-products?q={quote_plus(query)}&type=pokemon&format=json"
    log.info("Searching PriceCharting: %s", search_url)
    try:
        resp = session.get(search_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        data = resp.json()
        products = data if isinstance(data, list) else data.get("products", [])
        if products:
            # Pick the first (best) match
            p = products[0]
            product_id = p.get("id", "")
            if product_id:
                product_url = f"{PRICECHARTING_BASE}/offers?product={product_id}"
                log.info("Found URL: %s", product_url)
                return product_url
    except Exception as e:
        log.warning("PriceCharting search failed: %s", e)
    return None

# ============================================================
# IMAGE DOWNLOAD
# ============================================================

def download_image(session, image_url, card_name, card_set=""):
    """Download card image and save locally; return the GitHub Pages URL."""
    if not image_url:
        return ""
    safe_name = re.sub(r'[^\w\-]', '_', f"{card_name}_{card_set}".strip('_').lower())
    ext = ".png"
    if ".jpg" in image_url.lower() or ".jpeg" in image_url.lower():
        ext = ".jpg"
    local_path = IMAGES_DIR / f"{safe_name}{ext}"
    if local_path.exists():
        return f"{GITHUB_PAGES_BASE}/images/cards/{safe_name}{ext}"
    try:
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        resp = session.get(image_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        local_path.write_bytes(resp.content)
        log.info("Downloaded image → %s", local_path.name)
        return f"{GITHUB_PAGES_BASE}/images/cards/{safe_name}{ext}"
    except Exception as e:
        log.warning("Image download failed: %s", e)
        return ""

# ============================================================
# MAIN SCRAPING PIPELINE
# ============================================================

log = logging.getLogger("scraper")

def scrape_card(session, card):
    """Scrape one card's full price history from pricecharting.com."""
    name       = str(card.get("Card Name", "")).strip()
    card_set   = str(card.get("Set", "")).strip()
    card_num   = str(card.get("Card Number", "")).strip()
    pc_url     = str(card.get("PriceCharting URL", "")).strip()
    image_url  = str(card.get("Image URL", "")).strip()

    if not name:
        log.warning("Skipping card with no name")
        return None

    log.info("=== Scraping: %s (%s) ===", name, card_set)

    # Find PriceCharting URL if missing
    if not pc_url or not pc_url.startswith("http"):
        pc_url = find_pricecharting_url(session, name, card_set)
        if not pc_url:
            log.warning("No URL found — skipping %s", name)
            return None

    time.sleep(REQUEST_DELAY)

    # Fetch the product page
    try:
        resp = session.get(pc_url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
    except Exception as e:
        log.error("Failed to fetch %s: %s", pc_url, e)
        return None

    page_text = resp.text
    soup = BeautifulSoup(page_text, "html.parser")

    # Extract VGPC.chart_data
    chart_data = extract_js_object(page_text, "VGPC.chart_data")
    price_history = parse_chart_data(chart_data) if chart_data else {"ungraded": [], "psa9": [], "psa10": []}

    # Extract volume data
    volumes = extract_volume(soup)
    apply_volume(price_history, volumes)

    # Extract PSA population
    pop_data = extract_js_object(page_text, "VGPC.pop_data")
    psa_pop = parse_psa_pop(pop_data) if pop_data else {"psa9": None, "psa10": None}

    # Get current price as fallback
    current_price = extract_current_price(soup)

    # Download image if missing or if the local file doesn't exist
    github_image_url = image_url
    local_exists = False
    if github_image_url and GITHUB_PAGES_BASE in github_image_url:
        local_name = github_image_url.rsplit("/", 1)[-1]
        local_exists = (IMAGES_DIR / local_name).exists()
    needs_download = (
        not github_image_url
        or "pokemontcg.io" in github_image_url
        or (GITHUB_PAGES_BASE in github_image_url and not local_exists)
    )
    if needs_download:
        dl_url = image_url if image_url and "pokemontcg.io" in image_url else ""
        if not dl_url:
            img_tag = soup.select_one("#product_image img, .product-image img")
            if img_tag:
                dl_url = img_tag.get("src", "")
                if dl_url and not dl_url.startswith("http"):
                    dl_url = urljoin(PRICECHARTING_BASE, dl_url)
        github_image_url = download_image(session, dl_url, name, card_set) if dl_url else ""

    return {
        "cardName": name,
        "set": card_set,
        "cardNumber": card_num,
        "priceHistory": price_history,
        "psaPop": psa_pop,
        "currentPrice": current_price,
        "pcUrl": pc_url,
        "imageUrl": github_image_url,
    }

def upload_results(session, result):
    """Upload scraped data to Google Sheets via Apps Script."""
    if not APPS_SCRIPT_URL:
        log.warning("No APPS_SCRIPT_URL set — skipping upload")
        return

    name = result["cardName"]
    card_set = result["set"]
    card_num = result["cardNumber"]

    # Upload price history
    for cond_key in ("ungraded", "psa9", "psa10"):
        points = result["priceHistory"].get(cond_key, [])
        if not points:
            continue
        payload = {
            "action": "updateCardPriceHistory",
            "cardName": name,
            "set": card_set,
            "cardNumber": card_num,
            "conditionType": cond_key,
            "priceData": points,
        }
        try:
            api_post(session, "updateCardPriceHistory", payload)
            log.info("Uploaded %d %s price points for %s", len(points), cond_key, name)
        except Exception as e:
            log.error("Failed to upload %s prices for %s: %s", cond_key, name, e)

    # Upload PSA population
    if result["psaPop"]["psa9"] is not None or result["psaPop"]["psa10"] is not None:
        payload = {
            "action": "updatePsaPopulation",
            "cardName": name,
            "set": card_set,
            "cardNumber": card_num,
            "psa9Pop":  result["psaPop"]["psa9"],
            "psa10Pop": result["psaPop"]["psa10"],
        }
        try:
            api_post(session, "updatePsaPopulation", payload)
            log.info("Uploaded PSA pop for %s (9:%s, 10:%s)", name, result["psaPop"]["psa9"], result["psaPop"]["psa10"])
        except Exception as e:
            log.error("Failed to upload PSA pop for %s: %s", name, e)

    # Update PriceCharting URL and image URL in Inventory
    if result["pcUrl"]:
        try:
            api_post(session, "updatePriceChartingUrls", {
                "action": "updatePriceChartingUrls",
                "cards": [{"cardName": name, "set": card_set, "url": result["pcUrl"]}],
            })
        except Exception as e:
            log.warning("Failed to update PriceCharting URL: %s", e)

    if result["imageUrl"]:
        try:
            api_post(session, "updateImageUrls", {
                "action": "updateImageUrls",
                "cards": [{"cardName": name, "set": card_set, "imageUrl": result["imageUrl"]}],
            })
        except Exception as e:
            log.warning("Failed to update Image URL: %s", e)

    # Update current price
    if result["currentPrice"] is not None:
        try:
            api_post(session, "updateCurrentPrice", {
                "action": "updateCurrentPrice",
                "cardName": name,
                "set": card_set,
                "price": result["currentPrice"],
            })
        except Exception as e:
            log.warning("Failed to update current price: %s", e)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    if not APPS_SCRIPT_URL:
        log.error("APPS_SCRIPT_URL not set. Export it as an environment variable.")
        sys.exit(1)

    session = requests.Session()

    # Fetch inventory from Google Sheets
    log.info("Fetching inventory from Google Sheets...")
    inv_data = api_get(session, "getInventory")
    if inv_data.get("status") != "success":
        log.error("Failed to fetch inventory: %s", inv_data.get("message", "unknown error"))
        sys.exit(1)

    cards = inv_data.get("data", [])
    log.info("Found %d cards in inventory", len(cards))

    # Filter to single card if CARD_NAME is set
    if CARD_NAME:
        cards = [c for c in cards if CARD_NAME.lower() in str(c.get("Card Name", "")).lower()]
        log.info("Filtered to %d card(s) matching '%s'", len(cards), CARD_NAME)

    if not cards:
        log.info("No cards to scrape.")
        return

    for card in cards:
        result = scrape_card(session, card)
        if result:
            upload_results(session, result)

    log.info("Done! Scraped %d card(s).", len(cards))


if __name__ == "__main__":
    main()
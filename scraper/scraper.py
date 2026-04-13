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

GITHUB_PAGES_BASE = "https://coleharding3.github.io/pokemoncardtracker"
IMAGES_DIR        = Path("images/cards")

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
    for sel in ["#used_price .price", ".price-box .price", "#complete_price .price"]:
        el = soup.select_one(sel)
        if el:
            try:
                return float(el.get_text(strip=True).replace("$", "").replace(",", ""))
            except ValueError:
                continue
    return None

# ============================================================
# MAIN SCRAPE FUNCTION PER CARD
# ============================================================

def scrape_card(url, session):
    """
    Scrape a PriceCharting product page for a single card.
    Returns dict with priceHistory, psaPopulation, currentPrice, productId.
    """
    resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    page_text = resp.text
    soup = BeautifulSoup(page_text, "html.parser")

    product_id = get_product_id(soup, page_text)
    log.info("  product_id: %s", product_id or "not found")

    # Price history from VGPC.chart_data
    chart_data = extract_js_object(page_text, "VGPC.chart_data")
    if chart_data:
        log.info("  chart_data keys: %s", list(chart_data.keys()))
        price_history = parse_chart_data(chart_data)
        pts = {k: len(v) for k, v in price_history.items()}
        log.info("  history points: ungraded=%d psa9=%d psa10=%d",
                 pts["ungraded"], pts["psa9"], pts["psa10"])
    else:
        log.warning("  VGPC.chart_data not found")
        price_history = {"ungraded": [], "psa9": [], "psa10": []}

    # Volume from completed-sales tables
    volumes = extract_volume(soup)
    price_history = apply_volume(price_history, volumes)

    # PSA population from VGPC.pop_data
    pop_data = extract_js_object(page_text, "VGPC.pop_data")
    psa_pop = parse_psa_pop(pop_data)
    log.info("  PSA pop — 9: %s  10: %s", psa_pop["psa9"], psa_pop["psa10"])

    # Current price fallback
    current_price = extract_current_price(soup)
    if current_price is None:
        # Use last ungraded history point
        ug = price_history.get("ungraded", [])
        if ug:
            current_price = ug[-1]["price"]

    return {
        "priceHistory": price_history,
        "psaPopulation": psa_pop,
        "currentPrice": current_price,
        "productId": product_id,
    }

def derive_image_filename(image_url):
    """
    Convert a Pokemon TCG API image URL to a local filename.
    e.g. https://images.pokemontcg.io/swsh7/215_hires.png -> swsh7-215_hires.png
    Falls back to a sanitized basename if the pattern doesn't match.
    """
    m = re.search(r"images\.pokemontcg\.io/([^/]+)/([^/?#]+)", image_url or "")
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    # Fallback: strip query params and use the last path component
    basename = image_url.rstrip("/").split("/")[-1].split("?")[0]
    return re.sub(r"[^\w.\-]", "_", basename) or "card.png"


def download_images(inventory, session):
    """
    Download card images from TCG API URLs to images/cards/.
    Returns list of {rowIndex, imageUrl} dicts with GitHub Pages URLs for cards
    whose image was newly saved (or already existed on disk).
    Only processes cards that have an image URL pointing to pokemontcg.io.
    """
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    updates = []

    for card in inventory:
        image_url = (card.get("Image URL") or "").strip()
        if not image_url or "pokemontcg.io" not in image_url:
            continue

        filename = derive_image_filename(image_url)
        local_path = IMAGES_DIR / filename
        gh_url = f"{GITHUB_PAGES_BASE}/images/cards/{filename}"

        # Skip download if already on disk
        if local_path.exists():
            updates.append({"rowIndex": card["_rowIndex"], "imageUrl": gh_url})
            continue

        try:
            time.sleep(REQUEST_DELAY * 0.4)  # lighter delay for image CDN
            resp = session.get(image_url, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            local_path.write_bytes(resp.content)
            log.info("  image saved: %s", filename)
            updates.append({"rowIndex": card["_rowIndex"], "imageUrl": gh_url})
        except Exception as e:
            log.warning("  image download failed (%s): %s", filename, e)

    return updates


def search_for_url(card_name, set_name, session):
    """Search PriceCharting for a card and return its product URL."""
    query = f"{card_name} {set_name}".strip()
    url = f"{PRICECHARTING_BASE}/search-products?q={quote_plus(query)}&type=pokemon"
    try:
        resp = session.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        link = soup.select_one("table.results td.title a")
        if link:
            found = urljoin(PRICECHARTING_BASE, link["href"])
            log.info("  Found via search: %s", found)
            return found
    except Exception as e:
        log.error("  Search error: %s", e)
    return None

# ============================================================
# MAIN
# ============================================================

def scrape_all():
    log.info("=" * 64)
    log.info("Pokemon Card Portfolio Scraper — Full History Mode")
    log.info("=" * 64)

    session = requests.Session()
    session.headers.update(HEADERS)

    # Load inventory
    log.info("Fetching inventory…")
    try:
        result = api_get(session, "getInventory")
    except Exception as e:
        log.error("Failed to fetch inventory: %s", e)
        sys.exit(1)

    if result.get("status") != "success":
        log.error("API error: %s", result.get("message"))
        sys.exit(1)

    inventory = result.get("data", [])
    if not inventory:
        log.info("Inventory is empty.")
        sys.exit(0)

    log.info("Found %d cards.", len(inventory))

    # Filter to a single card if CARD_NAME is set
    if CARD_NAME:
        inventory = [c for c in inventory if c.get("Card Name", "").strip().lower() == CARD_NAME.lower()]
        if not inventory:
            log.error("No card found matching CARD_NAME=%r", CARD_NAME)
            sys.exit(1)
        log.info("Filtered to %d card(s) matching %r.", len(inventory), CARD_NAME)

    log.info("")

    # Download card images and update sheet Image URL column
    log.info("Downloading card images…")
    image_updates = download_images(inventory, session)
    if image_updates:
        log.info("Updating %d image URL(s)…", len(image_updates))
        try:
            res = api_post(session, "updateImageUrls", {"data": image_updates})
            log.info("  %s", res.get("message", "ok"))
        except Exception as e:
            log.error("  Image URL update failed: %s", e)

    log.info("")

    price_updates    = []
    url_updates      = []   # newly discovered PriceCharting URLs to save back
    total_value      = 0.0
    total_cards      = 0
    highest_card     = None
    highest_price    = 0.0

    for idx, card in enumerate(inventory):
        name        = card.get("Card Name", "Unknown")
        set_name    = card.get("Set", "")
        card_number = card.get("Card Number", "")
        url         = (card.get("PriceCharting URL") or "").strip()
        row_index   = card.get("_rowIndex")
        qty         = float(card.get("Quantity") or 1)

        log.info("[%d/%d] %s — %s", idx + 1, len(inventory), name, set_name)

        # Auto-discover URL via search if missing
        if not url:
            time.sleep(REQUEST_DELAY)
            url = search_for_url(name, set_name, session)
            if not url:
                log.warning("  No URL found — skipping.\n")
                total_value  += float(card.get("Current Price") or 0) * qty
                total_cards  += int(qty)
                continue
            # Queue the discovered URL so it's saved back to the sheet
            url_updates.append({"rowIndex": row_index, "url": url})
            log.info("  URL queued for save: %s", url)

        # Scrape
        time.sleep(REQUEST_DELAY)
        try:
            data = scrape_card(url, session)
        except Exception as e:
            log.error("  Scrape error: %s\n", e)
            total_value += float(card.get("Current Price") or 0) * qty
            total_cards += int(qty)
            continue

        current_price = data["currentPrice"] or float(card.get("Current Price") or 0)

        # Queue inventory price update
        if current_price > 0:
            price_updates.append({"rowIndex": row_index, "currentPrice": current_price})

        total_value += current_price * qty
        total_cards += int(qty)
        if current_price > highest_price:
            highest_price = current_price
            highest_card  = name

        # POST price history
        history = data["priceHistory"]
        if any(len(v) for v in history.values()):
            try:
                res = api_post(session, "updatePriceHistory", {
                    "cardName":   name,
                    "set":        set_name,
                    "cardNumber": card_number,
                    "history":    history,
                })
                log.info("  history → %s", res.get("message", "ok"))
            except Exception as e:
                log.error("  history POST failed: %s", e)

        # POST PSA population
        pop = data["psaPopulation"]
        if pop.get("psa9") is not None or pop.get("psa10") is not None:
            try:
                res = api_post(session, "updatePsaPopulation", {
                    "cardName":   name,
                    "set":        set_name,
                    "cardNumber": card_number,
                    "psa9Pop":    pop["psa9"],
                    "psa10Pop":   pop["psa10"],
                })
                log.info("  psa pop → %s", res.get("message", "ok"))
            except Exception as e:
                log.error("  psa pop POST failed: %s", e)

        log.info("")

    # Save newly discovered PriceCharting URLs back to the sheet
    if url_updates:
        log.info("Saving %d discovered PriceCharting URL(s)…", len(url_updates))
        try:
            res = api_post(session, "updatePriceChartingUrls", {"data": url_updates})
            log.info("  %s", res.get("message", "ok"))
        except Exception as e:
            log.error("  URL save failed: %s", e)

    # Bulk update current prices
    if price_updates:
        log.info("Updating %d current prices…", len(price_updates))
        try:
            res = api_post(session, "updatePrices", {"data": price_updates})
            log.info("  %s", res.get("message", "ok"))
        except Exception as e:
            log.error("  Price update failed: %s", e)

    # Portfolio snapshot
    daily_change = daily_change_pct = 0.0
    try:
        snaps = api_get(session, "getPortfolio").get("data", [])
        if snaps:
            prev = float(snaps[-1].get("Total Portfolio Value") or 0)
            daily_change = total_value - prev
            daily_change_pct = (daily_change / prev * 100) if prev else 0.0
    except Exception as e:
        log.warning("Could not fetch snapshots: %s", e)

    today = date.today().isoformat()
    try:
        api_post(session, "addSnapshot", {"data": {
            "date":             today,
            "totalCards":       total_cards,
            "totalValue":       round(total_value, 2),
            "dailyChange":      round(daily_change, 2),
            "dailyChangePct":   round(daily_change_pct, 4),
            "highestValueCard": highest_card or "",
        }})
        log.info("Snapshot added: %s  $%.2f", today, total_value)
    except Exception as e:
        log.error("Snapshot failed: %s", e)

    log.info("\n" + "=" * 64)
    log.info("Done. Portfolio value: $%.2f", total_value)
    log.info("=" * 64)


if __name__ == "__main__":
    if not APPS_SCRIPT_URL:
        log.error("Set the APPS_SCRIPT_URL environment variable first.")
        sys.exit(1)
    scrape_all()

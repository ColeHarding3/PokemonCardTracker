# CLAUDE.md

## Workflow

- **Auto-commit and push** after every change. User tests via GitHub Pages auto-deploy, so changes must be pushed to be verified.

## Architecture

- **Frontend**: Static HTML/CSS/JS served via GitHub Pages (`index.html`, `js/app.js`, `css/style.css`)
- **Backend**: Google Apps Script (`google-apps-script/Code.gs`) — serves as API for CRUD, price history, and scraper triggers
- **Scraper**: Python (`scraper/scraper.py`) — runs via GitHub Actions weekly or on-demand, scrapes PriceCharting for prices and card images
- **Data**: Google Sheets (Inventory, PriceHistory, Snapshots, PsaPopulation tabs)

## Key Details

- Config lives in `js/config.js` — holds `APPS_SCRIPT_URL` and `POKEMON_TCG_API_KEY`
- Card images are self-hosted in `images/cards/` and served via GitHub Pages URLs
- Scraper downloads images locally, GitHub Actions workflow (`scrape.yml`) commits and pushes them
- Frontend communicates with Apps Script via `apiFetch` (GET) and `apiPost` (POST, no-cors)
- GitHub Pages base URL: `https://coleharding3.github.io/PokemonCardTracker`

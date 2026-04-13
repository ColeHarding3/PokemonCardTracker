# Pokemon Card Portfolio Tracker — Setup Guide

Welcome! This guide walks you through getting everything running in about 15 minutes.
No coding experience needed.

---

## What you're setting up

- **Google Apps Script** — the "backend" that reads and writes to your Google Sheet
- **GitHub Pages** — the website you'll view your portfolio on
- **GitHub Actions** — an automated job that updates prices weekly

---

## Step 1: Set up your Google Sheet

Your Google Sheet should have these tabs (the script can create them automatically):

- **Inventory** — your card list
- **Price History** — price changes over time
- **Portfolio Snapshots** — daily portfolio totals
- **Settings** — configuration values

If the tabs don't exist yet, you can create them by running the `setupSheet()` function after pasting the script (see Step 2).

---

## Step 2: Open the Apps Script editor

1. Open your Google Sheet: `https://docs.google.com/spreadsheets/d/1ZCnNBJcyCvc7kSa6WfHsnnPP4eEHyZCKaBuZPbDF8DU`
2. Click **Extensions** in the top menu bar.
3. Click **Apps Script**.
4. A new tab will open — this is the script editor.

---

## Step 3: Paste the script code

1. In the script editor, you'll see a file called `Code.gs` with some placeholder code.
2. **Select all** the existing code (Ctrl+A or Cmd+A) and **delete it**.
3. Open the file `google-apps-script/Code.gs` from this repository.
4. **Copy all** of its contents and **paste** it into the script editor.
5. Click the **Save** button (floppy disk icon, or Ctrl+S).

### Run the setup function (first time only)

1. In the toolbar at the top of the script editor, find the function dropdown — it probably says `doGet`.
2. Click it and select **`setupSheet`** from the list.
3. Click the **Run** button (▶ play icon).
4. Google will ask you to authorize the script — click **Review permissions**, choose your Google account, and click **Allow**.
5. You should see "Sheet setup complete" in the output at the bottom.

---

## Step 4: Deploy the script as a Web App

This gives the website an address it can talk to.

1. In the Apps Script editor, click **Deploy** (top right).
2. Click **New deployment**.
3. Click the gear icon ⚙️ next to "Select type" and choose **Web app**.
4. Fill in the settings:
   - **Description**: `Pokemon Card Tracker API` (or anything you like)
   - **Execute as**: `Me`
   - **Who has access**: `Anyone` ← **important**, this lets your website talk to it
5. Click **Deploy**.
6. Google will ask you to authorize again — click **Allow**.
7. You'll see a **Web app URL** that looks like:
   ```
   https://script.google.com/macros/s/XXXXXXXXXXXXXXXXX/exec
   ```
8. **Copy this URL** — you'll need it in the next step.

> **Note**: Every time you edit and re-deploy the script, you need to choose "Manage deployments" → edit the existing deployment → bump the version. The URL stays the same.

---

## Step 5: Connect the website to your script

1. Open the file `js/config.js` in this repository.
2. Paste your Web App URL between the quotes on the `APPS_SCRIPT_URL` line:
   ```js
   APPS_SCRIPT_URL: "https://script.google.com/macros/s/XXXXXXXXX/exec",
   ```
3. Save and commit the file (or use the GitHub website editor).

---

## Step 6: Enable GitHub Pages

This makes your website publicly viewable.

1. Go to your repository on GitHub: `https://github.com/Coleharding3/pokemoncardtracker`
2. Click **Settings** (top right of the repo page).
3. Scroll down to **Pages** in the left sidebar.
4. Under **Source**, select **Deploy from a branch**.
5. Under **Branch**, choose **main** and click **Save**.
6. After a minute or two, your site will be live at:
   ```
   https://coleharding3.github.io/PokemonCardTracker/
   ```

---

## Step 7: Add your Apps Script URL as a GitHub Secret

This lets the weekly price-scraper job know where to send updates.

1. Go to your repository on GitHub.
2. Click **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Set:
   - **Name**: `APPS_SCRIPT_URL`
   - **Value**: paste your Web App URL from Step 4
5. Click **Add secret**.

---

## Step 8: Store your GitHub PAT in Apps Script (for the Refresh buttons)

The **↻ Refresh Prices** and **↻ Refresh This Card** buttons on the website trigger GitHub Actions on demand. They work by calling your Apps Script, which in turn calls the GitHub API — keeping your token server-side and out of the browser.

### Create a Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Click **Generate new token (classic)**.
3. Give it a name like `pokemon-card-tracker`.
4. Under **Scopes**, check **`workflow`** (this covers reading and writing GitHub Actions).
5. Click **Generate token** and copy the value — you won't see it again.

> Alternatively, use a **fine-grained token** with **Actions: Read and Write** permission scoped to the `pokemoncardtracker` repository.

### Store the token in Apps Script

1. In the Apps Script editor, click the **gear icon ⚙️** (Project Settings) in the left sidebar.
2. Scroll down to **Script Properties**.
3. Click **Add script property**.
4. Set:
   - **Property**: `GITHUB_TOKEN`
   - **Value**: paste your Personal Access Token
5. Click **Save script properties**.

The token is stored securely server-side and is never exposed in your website's source code.

---

## Step 9: Manually trigger the price scraper (optional)

You don't have to wait until Sunday — you can run it anytime:

**From the website** (after completing Step 8):
- Click **↻ Refresh Prices** in the top-right header to refresh all cards.
- Open any card's detail view and click **↻ Refresh This Card** to refresh just that one card.

**From GitHub directly**:
1. Go to your repository on GitHub.
2. Click the **Actions** tab.
3. Click **Scrape Pokemon Card Prices** in the left sidebar.
4. Click **Run workflow** → **Run workflow**.
5. The job will run and update your prices in Google Sheets.

---

## Adding your first card

1. Visit your GitHub Pages site.
2. On first load, it will ask for your Apps Script URL — paste it in.
3. Click **+ Add Card**.
4. Fill in the card name, set, condition, purchase price, etc.
5. If you have a PriceCharting URL for the card, paste it in — the scraper will use it to auto-update prices.
6. Click **Save Card**.

Your card will appear in the inventory table immediately!

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Website shows "Failed to load data" | Make sure your Apps Script is deployed with "Anyone" access |
| Cards aren't saving | Re-deploy the Apps Script (Step 4), bump the version |
| Prices not updating | Check the GitHub Actions tab for error logs |
| Refresh buttons show "GITHUB_TOKEN not set" | Complete Step 8 to add the PAT as a Script Property, then re-deploy the Apps Script |
| Sheet tabs are missing | Run `setupSheet()` in the Apps Script editor (Step 3) |

---

## Questions?

Everything is in this repository. The Google Sheet ID is:
`1ZCnNBJcyCvc7kSa6WfHsnnPP4eEHyZCKaBuZPbDF8DU`

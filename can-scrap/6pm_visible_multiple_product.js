/**
 * 6pm PDP Variant Matrix Extractor (VISIBLE MODE) - Multiple Products
 * ---------------------------------------------------------------
 * Goal:
 *  - Read a CSV input (sku,url) and visit each 6pm product page
 *  - Extract variant matrix: color x size -> price + availability
 *  - Availability logic:
 *      IN STOCK  -> "Add to Shopping Bag" button present
 *      OUT STOCK -> "Notify Me" button OR out-of-stock popup appears
 *
 * Why Playwright (Visible mode)?
 *  - 6pm often renders UI dynamically and variant availability can be triggered
 *    only after selecting color/size.
 *  - Visible mode helps you see what is happening (debug).
 *
 * Handles:
 *  ✅ Duplicate color labels (mobile + desktop) by clicking only the visible label
 *  ✅ Out-of-stock popup that blocks clicks (auto close)
 *  ✅ Color switch -> re-fetch sizes (DOM changes)
 *  ✅ Writes:
 *      - one combined JSON file for all products
 *      - one combined CSV file for all products
 *
 * Requirements:
 *  - Node.js 18+ / 20+
 *  - package.json must have: { "type": "module" }
 *  - Install playwright: npm i -D playwright
 *
 * Usage:
 *  node 6pm_visible_multiple_product.js --in ./6pm.csv --out ./out
 *
 * Input CSV format:
 *  sku,url
 *  451-lot6267,https://www.6pm.com/p/womens-calvin-klein-presley/product/10008224
 *  345-lot6267,https://www.6pm.com/p/....../product/12345678
 */

import fs from "fs";
import path from "path";
import { chromium } from "playwright";

/* ----------------------------- CLI / DEFAULTS ----------------------------- */

const DEFAULTS = {
  inFile: "./input.csv",
  outDir: "./out",
  headless: false, // Visible mode: browser will open
  slowMo: 150, // Slow down actions so you can see what is happening
  timeoutMs: 60000,
  waitAfterLoadMs: 800,
  waitAfterClickMs: 500,
  keepOpenMs: 3000, // after each product (debug) - can set 0
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--in") args.inFile = rest[++i] || args.inFile;
    else if (a === "--out") args.outDir = rest[++i] || args.outDir;
    else if (a === "--headless") args.headless = true;
    else if (a === "--slowMo") args.slowMo = Number(rest[++i] || args.slowMo);
    else if (a === "--timeoutMs")
      args.timeoutMs = Number(rest[++i] || args.timeoutMs);
    else if (a === "--keepOpenMs")
      args.keepOpenMs = Number(rest[++i] || args.keepOpenMs);
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/* ------------------------------- CSV HELPERS ------------------------------ */

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCSV(headers, rows) {
  const lines = [];
  lines.push(headers.join(","));
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  }
  return lines.join("\n");
}

function parseInputCSV(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);

  // Expect header: sku,url (case-insensitive)
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const skuIdx = header.indexOf("sku");
  const urlIdx = header.indexOf("url");

  if (skuIdx === -1 || urlIdx === -1) {
    throw new Error('Input CSV must have header: "sku,url"');
  }

  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // simple CSV split (works if URL has no commas - which it doesn't)
    const parts = line.split(",");
    const sku = (parts[skuIdx] || "").trim();
    const url = (parts[urlIdx] || "").trim();
    if (!sku || !url) continue;

    items.push({ input_sku: sku, url });
  }
  return items;
}

/* ----------------------------- PLAYWRIGHT HELPERS ----------------------------- */

/**
 * Some labels exist twice on 6pm (mobile + desktop).
 * This function clicks the first VISIBLE label matching `for="..."`.
 */
async function clickVisibleLabel(page, inputId, timeout = 20000) {
  const labels = page.locator(`label[for="${inputId}"]`);
  const count = await labels.count();
  if (!count) throw new Error(`Label not found for: ${inputId}`);

  for (let i = 0; i < count; i++) {
    const lbl = labels.nth(i);
    if (await lbl.isVisible().catch(() => false)) {
      await lbl.scrollIntoViewIfNeeded();
      await lbl.click({ timeout });
      return;
    }
  }

  // fallback: force click
  await labels
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await labels.first().click({ timeout, force: true });
}

/**
 * When a size is out of stock, 6pm may show a full blocking popup:
 *  "Sorry, this is out of stock. You just missed it."
 * That popup blocks further clicks until closed.
 *
 * This function detects it and closes it.
 */
async function closeOOSPopupIfOpen(page) {
  const popup = page.locator("div.Lp-z.Mp-z");
  if (!(await popup.isVisible().catch(() => false))) return false;

  console.error("⚠️ OOS popup detected. Closing...");

  const closeSvg = popup.locator("svg").last();
  try {
    await closeSvg.scrollIntoViewIfNeeded().catch(() => {});
    await closeSvg.click({ timeout: 5000 });
  } catch {
    const box = await popup.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width - 15, box.y + 15);
    }
  }

  await popup.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
  return true;
}

/**
 * Availability rules:
 *  - If OOS popup visible => OUT OF STOCK
 *  - Else if "Notify Me" visible => OUT OF STOCK
 *  - Else if add-to-cart button visible => IN STOCK
 */
async function getAvailability(page) {
  const popupOpen = await page
    .locator("div.Lp-z.Mp-z")
    .isVisible()
    .catch(() => false);

  if (popupOpen) return "OUT OF STOCK";

  if (await page.locator('button:has-text("Notify Me")').count()) {
    return "OUT OF STOCK";
  }

  if (await page.locator("#add-to-cart-button").count()) {
    return "IN STOCK";
  }

  if (await page.locator('button:has-text("Add to Shopping Bag")').count()) {
    return "IN STOCK";
  }

  return "unknown";
}

/**
 * Price extraction:
 *  - selling price: itemprop="price" content="63.97"
 *  - msrp is displayed in the UI (MSRP: $79)
 *    selector may change; we use a tolerant approach.
 */
async function getPrice(page) {
  const selling = await page
    .getAttribute('[itemprop="price"]', "content")
    .catch(() => null);

  const msrpText = await page
    .locator("span.Ip-z")
    .first()
    .textContent()
    .catch(() => null);

  const msrp = msrpText ? msrpText.replace(/[^\d.]/g, "") : null;

  return {
    selling_price: selling ? Number(selling) : null,
    original_price: msrp ? Number(msrp) : null,
  };
}

/**
 * Extract top-level product info:
 * - productId (hidden input)
 * - brand (schema.org brand)
 * - product name (heading)
 */
async function getProductMeta(page) {
  const productId = await page
    .getAttribute('input[name="productId"]', "value")
    .catch(() => null);

  const brand = await page
    .textContent('[itemprop="brand"] [itemprop="name"]')
    .catch(() => null);

  const productName = await page
    .textContent("h1 span.zappos\\:heading-l")
    .catch(() => null);

  return {
    product_id: productId ? String(productId) : null,
    brand: brand?.trim() || null,
    product_name: productName?.trim() || null,
  };
}

/**
 * Color inputs:
 * - input[name="colorSelect"][data-style-id][data-color-name]
 * - There are duplicates in DOM; we dedupe by data-style-id
 */
async function getColors(page) {
  const colorInputs = await page.$$(
    'input[name="colorSelect"][data-style-id][data-color-name]',
  );

  const out = [];
  const seen = new Set();

  for (const c of colorInputs) {
    const colorName = await c.getAttribute("data-color-name");
    const colorId = await c.getAttribute("data-style-id");
    const inputId = await c.getAttribute("id");

    if (!colorId || seen.has(colorId)) continue;
    seen.add(colorId);

    out.push({
      color_id: String(colorId),
      color_name: colorName?.trim() || null,
      input_id: inputId || null,
    });
  }

  return out;
}

/**
 * Size inputs:
 * - input[data-track-label="size"][data-label]
 */
async function getSizes(page) {
  const sizeInputs = await page.$$(
    'input[data-track-label="size"][data-label]',
  );

  return Promise.all(
    sizeInputs.map(async (s) => ({
      size_label: (await s.getAttribute("data-label"))?.trim() || null,
      input_id: (await s.getAttribute("id")) || null,
    })),
  );
}

/* --------------------------- MAIN PRODUCT SCRAPER -------------------------- */

async function scrapeOneProduct(page, { input_sku, url }, cfg) {
  console.log("\n==============================");
  console.log("INPUT SKU:", input_sku);
  console.log("URL:", url);
  console.log("==============================");

  await page.goto(url, { waitUntil: "networkidle", timeout: cfg.timeoutMs });
  await page.waitForTimeout(cfg.waitAfterLoadMs);

  // close popup if any leftover
  await closeOOSPopupIfOpen(page);

  console.log("Final URL:", page.url());

  const meta = await getProductMeta(page);
  console.log("Product ID:", meta.product_id);
  console.log("Brand:", meta.brand);
  console.log("Product Name:", meta.product_name);

  const colors = await getColors(page);

  const rows = []; // flat rows for CSV
  const matrix = []; // nested for JSON

  for (const color of colors) {
    console.log(`\nColor: ${color.color_name} | ID: ${color.color_id}`);

    await closeOOSPopupIfOpen(page);
    if (color.input_id) {
      await clickVisibleLabel(page, color.input_id);
      await page.waitForTimeout(cfg.waitAfterClickMs);
    }

    // DOM changes on color switch -> re-fetch sizes
    const sizes = await getSizes(page);

    const colorEntry = {
      color_id: color.color_id,
      color_name: color.color_name,
      sizes: [],
    };

    for (const size of sizes) {
      // ensure popup closed
      await closeOOSPopupIfOpen(page);

      if (size.input_id) {
        await clickVisibleLabel(page, size.input_id);
        await page.waitForTimeout(cfg.waitAfterClickMs);
      }

      const availability = await getAvailability(page);
      const price = await getPrice(page);

      console.log(
        `  Size: ${size.size_label} | Price: ${price.selling_price} | Availability: ${availability}`,
      );

      // close popup if size triggered it
      await closeOOSPopupIfOpen(page);

      const row = {
        input_sku,
        url,
        product_id: meta.product_id,
        brand: meta.brand,
        product_name: meta.product_name,
        color_id: color.color_id,
        color_name: color.color_name,
        size_label: size.size_label,
        original_price: price.original_price,
        selling_price: price.selling_price,
        availability,
      };

      rows.push(row);
      colorEntry.sizes.push(row);
    }

    matrix.push(colorEntry);
  }

  // keep browser open for a moment (debug)
  if (cfg.keepOpenMs > 0) await page.waitForTimeout(cfg.keepOpenMs);

  return {
    input_sku,
    url,
    ...meta,
    extracted_at: new Date().toISOString(),
    has_size_attribute: true, // 6pm shoes typically have size; if not, we can add fallback later
    matrix,
    flat_rows: rows,
  };
}

/* ----------------------------------- MAIN ---------------------------------- */

(async () => {
  const cfg = parseArgs(process.argv);
  ensureDir(cfg.outDir);

  const inputItems = parseInputCSV(cfg.inFile);
  if (!inputItems.length) {
    console.error("No rows found in input CSV.");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: cfg.headless,
    slowMo: cfg.slowMo,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    extraHTTPHeaders: {
      "accept-language": "en-US,en;q=0.9",
    },
  });

  const page = await context.newPage();

  const allProducts = [];
  const allRows = [];

  for (const item of inputItems) {
    try {
      const result = await scrapeOneProduct(page, item, cfg);
      allProducts.push(result);
      allRows.push(...result.flat_rows);
    } catch (e) {
      console.error("❌ Failed:", item.url, String(e?.message || e));

      // still write an error row so you don't lose tracking
      allRows.push({
        input_sku: item.input_sku,
        url: item.url,
        product_id: "",
        brand: "",
        product_name: "",
        color_id: "",
        color_name: "",
        size_label: "",
        original_price: "",
        selling_price: "",
        availability: "",
        error: String(e?.message || e),
      });
    }
  }

  await browser.close();

  // Write combined JSON
  const jsonPath = path.join(cfg.outDir, "6pm_all_products.json");
  fs.writeFileSync(jsonPath, JSON.stringify(allProducts, null, 2), "utf-8");

  // Write combined CSV
  const headers = [
    "input_sku",
    "url",
    "product_id",
    "brand",
    "product_name",
    "color_id",
    "color_name",
    "size_label",
    "original_price",
    "selling_price",
    "availability",
    "error",
  ];

  // Ensure error column exists in all rows
  const normalizedRows = allRows.map((r) => ({
    input_sku: r.input_sku ?? "",
    url: r.url ?? "",
    product_id: r.product_id ?? "",
    brand: r.brand ?? "",
    product_name: r.product_name ?? "",
    color_id: r.color_id ?? "",
    color_name: r.color_name ?? "",
    size_label: r.size_label ?? "",
    original_price: r.original_price ?? "",
    selling_price: r.selling_price ?? "",
    availability: r.availability ?? "",
    error: r.error ?? "",
  }));

  const csvPath = path.join(cfg.outDir, "6pm_all_products.csv");
  fs.writeFileSync(csvPath, rowsToCSV(headers, normalizedRows), "utf-8");

  console.error("\n✅ DONE");
  console.error("Saved JSON:", jsonPath);
  console.error("Saved CSV :", csvPath);
})();

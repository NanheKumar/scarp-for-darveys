/**
 * 6pm PDP Extractor (Visible Mode) - Multiple Products (CSV input)
 * --------------------------------------------------------------
 * Goal:
 * - Read input CSV: sku,url
 * - For each product URL:
 *    - Open PDP in Playwright (headed, so you can SEE what's happening)
 *    - Extract:
 *        product_id, brand, product_name
 *        colors (color_name, color_style_id)
 *        sizes (size_label)
 *        price (selling + original/MSRP)
 *        availability (IN STOCK vs OUT OF STOCK)
 *    - Handle OOS popup overlay (closes it automatically)
 *
 * IMPORTANT (Option B):
 * - Saves immediately after each product:
 *    1) Append one "product summary" line to JSONL
 *    2) Append all "variant rows" (color x size) to CSV
 *
 * Usage:
 *   node 6pm_visible_multiple_product_save_one_by_one.js --in ./6pm.csv --out ./out
 *
 * Input CSV example:
 *   sku,url
 *   451-lot6267,https://www.6pm.com/p/womens-calvin-klein-presley/product/10008224
 *
 * Notes:
 * - CSS classes on 6pm can change. We rely on stable attributes when possible:
 *   - brand: itemprop="brand" / schema
 *   - price: itemprop="price"
 *   - productId: hidden input name="productId"
 *   - colors: input[name="colorSelect"][data-style-id][data-color-name]
 *   - sizes: input[data-track-label="size"][data-label]
 */

import fs from "fs";
import path from "path";
import { chromium } from "playwright";

/** -----------------------
 * CLI args
 * ---------------------- */
function parseArgs(argv) {
  const args = {
    inFile: "./input.csv",
    outDir: "./out",
    headless: false,
    slowMo: 150,
    timeoutMs: 60000,
  };

  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--in") args.inFile = rest[++i] || args.inFile;
    else if (a === "--out") args.outDir = rest[++i] || args.outDir;
    else if (a === "--headless") args.headless = true;
    else if (a === "--slowmo") args.slowMo = Number(rest[++i] || args.slowMo);
    else if (a === "--timeout")
      args.timeoutMs = Number(rest[++i] || args.timeoutMs);
  }
  return args;
}

/** -----------------------
 * Helpers: FS
 * ---------------------- */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function appendLine(filePath, line) {
  fs.appendFileSync(filePath, line + "\n", "utf-8");
}

/** -----------------------
 * CSV Read
 * - minimal CSV parser (sku,url)
 * ---------------------- */
function readInputCSV(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/);
  const header = lines.shift();
  if (!header) return [];

  // Expect header contains sku,url
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;

    // very simple split by comma (works if URLs have no commas)
    const parts = line.split(",");
    const sku = (parts[0] || "").trim();
    const url = (parts.slice(1).join(",") || "").trim(); // join back in case url contains commas
    if (!sku || !url) continue;

    rows.push({ sku, url });
  }
  return rows;
}

/** -----------------------
 * Playwright Click Utils
 * - 6pm has multiple duplicate labels (mobile + desktop)
 * - so we click the visible one
 * ---------------------- */
async function clickVisibleLabel(page, inputId, timeout = 20000) {
  const labels = page.locator(`label[for="${inputId}"]`);
  const count = await labels.count();
  if (!count) throw new Error(`Label not found for: ${inputId}`);

  for (let i = 0; i < count; i++) {
    const lbl = labels.nth(i);
    if (await lbl.isVisible().catch(() => false)) {
      await lbl.scrollIntoViewIfNeeded().catch(() => {});
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

/** -----------------------
 * OOS Popup Handling
 * - This popup blocks clicks (pointer intercept)
 * - We detect & close it ASAP
 * ---------------------- */
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
  await page.waitForTimeout(250);
  return true;
}

/** -----------------------
 * Extractors
 * ---------------------- */
async function getPrice(page) {
  const selling = await page.getAttribute('[itemprop="price"]', "content");
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

async function getAvailability(page) {
  const popupOpen = await page
    .locator("div.Lp-z.Mp-z")
    .isVisible()
    .catch(() => false);
  if (popupOpen) return "OUT OF STOCK";

  if (await page.locator('button:has-text("Notify Me")').count())
    return "OUT OF STOCK";
  if (await page.locator("#add-to-cart-button").count()) return "IN STOCK";

  if (
    await page
      .locator('button[data-track-value*="Add-To-Cart"]')
      .count()
      .catch(() => 0)
  ) {
    return "IN STOCK";
  }

  return "unknown";
}

/** -----------------------
 * Core: Extract one PDP (one URL)
 * Returns:
 * - productSummary (for jsonl)
 * - variantRows (for csv)
 * ---------------------- */
async function extractProduct(page, { sku, url }) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

  const finalUrl = page.url();
  const productId = await page.getAttribute('input[name="productId"]', "value");

  const brand = await page
    .textContent('[itemprop="brand"] [itemprop="name"]')
    .catch(() => null);

  const productName = await page
    .textContent("h1 span.zappos\\:heading-l")
    .catch(() => null);

  // color inputs
  const colorInputs = await page.$$(
    'input[name="colorSelect"][data-style-id][data-color-name]',
  );

  const variants = [];
  const colorsSeen = new Set();

  for (const color of colorInputs) {
    const colorName = await color.getAttribute("data-color-name");
    const styleId = await color.getAttribute("data-style-id"); // you called it color id
    const inputId = await color.getAttribute("id");

    if (!styleId || colorsSeen.has(styleId)) continue;
    colorsSeen.add(styleId);

    await closeOOSPopupIfOpen(page);
    await clickVisibleLabel(page, inputId);
    await page.waitForTimeout(400);

    // size inputs (after color change)
    const sizeInputs = await page.$$(
      'input[data-track-label="size"][data-label]',
    );

    // Some products might not have sizes
    if (!sizeInputs.length) {
      const price = await getPrice(page);
      const availability = await getAvailability(page);

      variants.push({
        sku,
        url: finalUrl,
        product_id: productId || "",
        brand: brand?.trim() || "",
        product_name: productName?.trim() || "",
        color_id: styleId,
        color_name: colorName || "",
        size_label: "NS",
        selling_price: price.selling_price,
        original_price: price.original_price,
        availability,
      });

      await closeOOSPopupIfOpen(page);
      continue;
    }

    for (const size of sizeInputs) {
      const sizeLabel = await size.getAttribute("data-label");
      const sizeInputId = await size.getAttribute("id");

      await closeOOSPopupIfOpen(page);
      await clickVisibleLabel(page, sizeInputId);
      await page.waitForTimeout(400);

      const price = await getPrice(page);
      const availability = await getAvailability(page);

      variants.push({
        sku,
        url: finalUrl,
        product_id: productId || "",
        brand: brand?.trim() || "",
        product_name: productName?.trim() || "",
        color_id: styleId,
        color_name: colorName || "",
        size_label: sizeLabel || "",
        selling_price: price.selling_price,
        original_price: price.original_price,
        availability,
      });

      await closeOOSPopupIfOpen(page);
    }
  }

  const productSummary = {
    sku,
    url: finalUrl,
    product_id: productId || null,
    brand: brand?.trim() || null,
    product_name: productName?.trim() || null,
    variant_count: variants.length,
    extracted_at: new Date().toISOString(),
  };

  return { productSummary, variantRows: variants };
}

/** -----------------------
 * CSV header (written once)
 * ---------------------- */
function ensureCsvHeader(csvPath) {
  if (fs.existsSync(csvPath) && fs.statSync(csvPath).size > 0) return;

  const headers = [
    "sku",
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
  ];

  fs.writeFileSync(csvPath, headers.join(",") + "\n", "utf-8");
}

/** -----------------------
 * Main
 * ---------------------- */
(async () => {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);

  const csvOut = path.join(args.outDir, "6pm_results.csv");
  const jsonlOut = path.join(args.outDir, "6pm_results.jsonl");

  const inputRows = readInputCSV(args.inFile);
  if (!inputRows.length) {
    console.error("No rows found in input CSV.");
    process.exit(1);
  }

  // Prepare output files
  ensureCsvHeader(csvOut);
  if (!fs.existsSync(jsonlOut)) fs.writeFileSync(jsonlOut, "", "utf-8");

  const browser = await chromium.launch({
    headless: args.headless,
    slowMo: args.slowMo,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "en-US",
    timezoneId: "America/New_York",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
  });

  const page = await context.newPage();

  console.log(`Total products: ${inputRows.length}`);
  console.log(`Output CSV  : ${csvOut}`);
  console.log(`Output JSONL: ${jsonlOut}\n`);

  // ✅ OPTION B:
  // Process product -> save immediately -> move next
  for (let i = 0; i < inputRows.length; i++) {
    const row = inputRows[i];
    console.log(`\n[${i + 1}/${inputRows.length}] Processing SKU: ${row.sku}`);

    try {
      const { productSummary, variantRows } = await extractProduct(page, row);

      // 1) Append JSONL summary (one line per product)
      appendLine(jsonlOut, JSON.stringify(productSummary));

      // 2) Append CSV rows (many rows per product)
      for (const v of variantRows) {
        const line = [
          v.sku,
          v.url,
          v.product_id,
          v.brand,
          v.product_name,
          v.color_id,
          v.color_name,
          v.size_label,
          v.original_price,
          v.selling_price,
          v.availability,
        ]
          .map(csvEscape)
          .join(",");
        appendLine(csvOut, line);
      }

      console.log(
        `✅ Saved product: ${productSummary.product_id} | variants: ${variantRows.length}`,
      );
    } catch (e) {
      // If one product fails, log error and continue
      const errSummary = {
        sku: row.sku,
        url: row.url,
        error: String(e?.message || e),
        extracted_at: new Date().toISOString(),
      };
      appendLine(jsonlOut, JSON.stringify(errSummary));
      console.error(`❌ Failed SKU ${row.sku}:`, errSummary.error);
    }
  }

  console.log("\nDone. Browser will close in 5s...");
  await page.waitForTimeout(5000);

  await browser.close();
})();

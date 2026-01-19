/**
 * 6pm / Zappos PDP Extractor (Color x Size) - Playwright (HEADLESS)
 * Output: console logs (later JSON/CSV add kar sakte hain)
 *
 * Same functionality, but browser window will NOT open.
 *
 * Install:
 *   npm i playwright
 *   npx playwright install chromium
 *
 * Run:
 *   node 6pm_headless_single_product.js
 */

import { chromium } from "playwright";

const URL =
  "https://www.6pm.com/p/womens-karen-neuburger-plus-novelty-long-sleeve-girlfriend-pajama-set-love-at-the-dog-park/product/10034032/color/1124507";

function normalize6pmUrl(u) {
  // remove trailing /color/<id> if present
  return u.replace(/\/color\/\d+(\?.*)?$/, "");
}

async function clickVisibleLabel(page, inputId, timeout = 20000) {
  const labels = page.locator(`label[for="${inputId}"]`);
  const count = await labels.count();
  if (!count) throw new Error(`Label not found for: ${inputId}`);

  // visible label pick
  for (let i = 0; i < count; i++) {
    const lbl = labels.nth(i);
    if (await lbl.isVisible().catch(() => false)) {
      await lbl.scrollIntoViewIfNeeded().catch(() => {});
      await lbl.click({ timeout, force: true });
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

async function closeOOSPopupIfOpen(page) {
  const popup = page.locator("div.Lp-z.Mp-z");
  if (!(await popup.isVisible().catch(() => false))) return false;

  // close button: last svg inside popup
  const closeSvg = popup.locator("svg").last();

  try {
    await closeSvg.scrollIntoViewIfNeeded().catch(() => {});
    await closeSvg.click({ timeout: 5000, force: true });
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

async function getAvailability(page) {
  const popupOpen = await page
    .locator("div.Lp-z.Mp-z")
    .isVisible()
    .catch(() => false);
  if (popupOpen) return "OUT OF STOCK";

  if (await page.locator('button:has-text("Notify Me")').count()) {
    return "OUT OF STOCK";
  }
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

(async () => {
  const browser = await chromium.launch({
    headless: true, // ✅ browser window NOT open
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

  const fixedUrl = normalize6pmUrl(URL);
  await page.goto(fixedUrl, { waitUntil: "networkidle", timeout: 60000 });

  console.log("Final URL:", page.url());

  const productId = await page.getAttribute('input[name="productId"]', "value");
  const brand = await page
    .textContent('[itemprop="brand"] [itemprop="name"]')
    .catch(() => null);
  const productName = await page
    .textContent("h1 span.zappos\\:heading-l")
    .catch(() => null);

  console.log("Product ID:", productId);
  console.log("Brand:", brand?.trim());
  console.log("Product Name:", productName?.trim());

  const colorInputs = await page.$$(
    'input[name="colorSelect"][data-style-id][data-color-name]',
  );

  const seenColorIds = new Set();

  for (const color of colorInputs) {
    const colorName = await color.getAttribute("data-color-name");
    const colorId = await color.getAttribute("data-style-id");
    const inputId = await color.getAttribute("id");

    if (!colorId || seenColorIds.has(colorId)) continue;
    seenColorIds.add(colorId);

    console.log("\nColor:", colorName, "| ID:", colorId);

    await closeOOSPopupIfOpen(page);
    await clickVisibleLabel(page, inputId);
    await page.waitForTimeout(400);

    const sizeInputs = await page.$$(
      'input[data-track-label="size"][data-label]',
    );

    for (const size of sizeInputs) {
      const sizeLabel = await size.getAttribute("data-label");
      const sizeInputId = await size.getAttribute("id");

      await closeOOSPopupIfOpen(page);

      await clickVisibleLabel(page, sizeInputId);
      await page.waitForTimeout(400);

      const availability = await getAvailability(page);
      const price = await getPrice(page);

      console.log(
        "  Size:",
        sizeLabel,
        "| Price:",
        price.selling_price,
        "| Availability:",
        availability,
      );

      await closeOOSPopupIfOpen(page);
    }
  }

  await browser.close();
})().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

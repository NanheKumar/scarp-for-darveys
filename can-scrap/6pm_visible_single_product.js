/**
 * 6pm / Zappos PDP Extractor (Color x Size) - Playwright
 * Output: JSON + CSV
 *
 * Handles per-color/per-size availability by clicking options and reading CTA.
 *
 * Install:
 *   npm i playwright
 *   npx playwright install chromium
 *
 * Run 
 *   node 6pm_v1.js 
 
 */
import { chromium } from "playwright";

//const URL ="https://www.6pm.com/p/womens-calvin-klein-presley/product/10008224";
const URL =
  "https://www.6pm.com/p/womens-karen-neuburger-plus-novelty-long-sleeve-girlfriend-pajama-set-love-at-the-dog-park/product/10034032/color/1124507";

async function clickVisibleLabel(page, inputId, timeout = 20000) {
  const labels = page.locator(`label[for="${inputId}"]`);
  const count = await labels.count();
  if (!count) throw new Error(`Label not found for: ${inputId}`);

  // visible label pick
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

async function closeOOSPopupIfOpen(page) {
  // OOS popup container (your HTML shows: <div class="Lp-z Mp-z"> ...)
  const popup = page.locator("div.Lp-z.Mp-z");
  if (!(await popup.isVisible().catch(() => false))) return false;

  console.error("⚠️ OOS popup detected. Closing...");

  // close button is the "X" SVG at end
  // safest: click last svg inside popup
  const closeSvg = popup.locator("svg").last();

  // sometimes svg clickable, sometimes needs parent click
  try {
    await closeSvg.scrollIntoViewIfNeeded().catch(() => {});
    await closeSvg.click({ timeout: 5000 });
  } catch {
    // fallback: click near top-right of popup
    const box = await popup.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width - 15, box.y + 15);
    }
  }

  // wait until popup gone
  await popup.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(300);
  return true;
}

async function getAvailability(page) {
  // if popup is open, availability = OUT OF STOCK
  const popupOpen = await page
    .locator("div.Lp-z.Mp-z")
    .isVisible()
    .catch(() => false);
  if (popupOpen) return "OUT OF STOCK";

  if (await page.locator('button:has-text("Notify Me")').count()) {
    // this can also be inline notify button (disabled)
    return "OUT OF STOCK";
  }
  if (await page.locator("#add-to-cart-button").count()) {
    return "IN STOCK";
  }
  // sticky add to bag button
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
  // selling price content="63.97"
  const selling = await page.getAttribute('[itemprop="price"]', "content");
  // msrp displayed in span.Ip-z Jp-z OR content in DOM text
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
    headless: false,
    slowMo: 200, // visually debug
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

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });

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

  // COLORS inputs
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

    await closeOOSPopupIfOpen(page); // safety
    await clickVisibleLabel(page, inputId);
    await page.waitForTimeout(500);

    // re-fetch size inputs after color change (DOM changes)
    const sizeInputs = await page.$$(
      'input[data-track-label="size"][data-label]',
    );

    for (const size of sizeInputs) {
      const sizeLabel = await size.getAttribute("data-label");
      const sizeInputId = await size.getAttribute("id");

      // before clicking next size, ensure popup closed
      await closeOOSPopupIfOpen(page);

      await clickVisibleLabel(page, sizeInputId);
      await page.waitForTimeout(500);

      // if size click caused popup, close it after reading OOS
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

      // important: close popup so next size click won't be blocked
      await closeOOSPopupIfOpen(page);
    }
  }

  console.log("\nFinished. Browser will stay open for 30 seconds...");
  await page.waitForTimeout(30000);

  await browser.close();
})();

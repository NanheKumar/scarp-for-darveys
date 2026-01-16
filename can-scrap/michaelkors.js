// npm i playwright
// node michaelkors.js

const { chromium } = require("playwright");

const URL =
  "https://www.michaelkors.global/in/en/jet-set-medium-pebbled-leather-crossbody-bag/32F7GGNM8L.html";

const NOT_FOUND = "NOT_FOUND";

async function getText(page, selector) {
  try {
    const t = await page.locator(selector).first().innerText();
    return (t || "").trim() || NOT_FOUND;
  } catch {
    return NOT_FOUND;
  }
}

async function getCta(page) {
  // Add to Bag OR NOTIFY ME (per color)
  const txt = await getText(
    page,
    ".product-actions__buy-cta button.add-to-cart-label-js"
  );
  if (txt !== NOT_FOUND) return txt.replace(/\s+/g, " ").trim();
  return NOT_FOUND;
}

async function main() {
  const browser = await chromium.launch({ headless: false });

  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: "en-IN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  const title = await getText(page, "h1.product-name");
  const brand = await getText(page, ".product-brand.product-row");

  await page.waitForSelector(".color-attribute-value button.color-attribute", {
    timeout: 20000,
  });

  const btnIds = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll(".color-attribute-value button.color-attribute")
    )
      .map((b) => b.id)
      .filter(Boolean);
  });

  const variants = [];

  for (const id of btnIds) {
    await page.click(`#${id}`).catch(() => {});
    await page.waitForTimeout(1200);

    const color = await getText(page, ".display-color-name");

    const original_price = await getText(page, ".default-price .list .value");
    const sale_price = await getText(page, ".default-price .sales .value");
    const discount = await getText(page, ".default-price__discount");

    const cta = await getCta(page); // ✅ Add to Bag / NOTIFY ME

    variants.push({
      color,
      original_price,
      sale_price,
      discount,
      cta,
    });
  }

  console.log(
    JSON.stringify(
      {
        url: page.url(),
        title,
        brand,
        variants,
      },
      null,
      2
    )
  );

  await browser.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

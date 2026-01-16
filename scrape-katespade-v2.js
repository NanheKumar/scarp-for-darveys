// scrape-katespade-v2.js
// npm i playwright
// node scrape-katespade-v2.js

const { chromium } = require("playwright");

const URL =
  "https://www.katespadeoutlet.com/products/kendall-jelly-t-strap-sandal/KL418-403.html";

const NOT_FOUND = "NOT_FOUND";

async function getText(page, selector) {
  const loc = page.locator(selector).first();
  if ((await loc.count()) === 0) return NOT_FOUND;
  const txt = (await loc.innerText().catch(() => "")) || "";
  return txt.trim() || NOT_FOUND;
}

async function getActiveColorFromLabel(page) {
  const label = await getText(page, '[data-qa="cm_txt_pdt_label_color"]');
  // "Color: Multi" -> "Multi"
  if (label === NOT_FOUND) return NOT_FOUND;
  return label.replace(/^Color:\s*/i, "").trim() || NOT_FOUND;
}

async function getAllColors(page) {
  // swatches are: [data-qa="swatches_slide_swatch"] inside span[title]
  const titles = await page
    .evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('[data-qa="swatches_slide_swatch"]')
      );

      const t = nodes
        .map((n) => {
          const span = n.closest("span[title]");
          return span ? (span.getAttribute("title") || "").trim() : "";
        })
        .filter(Boolean);

      return Array.from(new Set(t));
    })
    .catch(() => []);

  return titles;
}

async function getSizes(page) {
  return await page
    .evaluate(() => {
      return Array.from(document.querySelectorAll(".product-size-button"))
        .map((b) => {
          const size = (b.innerText || "").trim();
          const unavailable = b.classList.contains("pdp-unavailable-size");
          return unavailable ? `${size} (Unavailable)` : size;
        })
        .filter(Boolean);
    })
    .catch(() => [NOT_FOUND]);
}

async function clickColor(page, title) {
  const swatch = page
    .locator(`span[title="${title}"] [data-qa="swatches_slide_swatch"]`)
    .first();

  if ((await swatch.count()) === 0) return false;

  await swatch.click({ timeout: 15000 });

  // wait until color label becomes this title (AJAX update)
  await page.waitForFunction(
    (t) => {
      const el = document.querySelector('[data-qa="cm_txt_pdt_label_color"]');
      if (!el) return false;
      const txt = (el.innerText || "").trim().replace(/^Color:\s*/i, "");
      return txt === t;
    },
    title,
    { timeout: 20000 }
  );

  // sizes should exist
  await page.waitForSelector(".product-size-button", { timeout: 20000 });
  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    // helps some sites render correct desktop DOM
    viewport: { width: 1280, height: 800 },
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle"); // IMPORTANT for React/AJAX

  // Wait for core PDP element(s)
  try {
    await page.waitForSelector('[data-qa="pdp_txt_pdt_title"]', {
      timeout: 20000,
    });
  } catch {}

  // Active color from label (reliable)
  const activeColor = await getActiveColorFromLabel(page);

  // Get colors (swatches)
  // Wait a bit for swatches to appear
  try {
    await page.waitForSelector('[data-qa="swatches_slide_swatch"]', {
      timeout: 20000,
    });
  } catch {}

  const colors = await getAllColors(page);

  const variants = [];

  // one-by-one
  for (const color of colors) {
    try {
      const ok = await clickColor(page, color);
      const sizes = ok ? await getSizes(page) : [NOT_FOUND];
      variants.push({ color, sizes });
    } catch {
      variants.push({ color, sizes: [NOT_FOUND] });
    }
  }

  console.log(
    JSON.stringify(
      {
        url: URL,
        activeColor,
        colors,
        variants,
      },
      null,
      2
    )
  );

  await browser.close();
})();

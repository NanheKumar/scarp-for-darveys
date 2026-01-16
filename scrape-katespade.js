// scrape-katespade.js
// npm i playwright
// node scrape-katespade.js

const { chromium } = require("playwright");

const URL =
  "https://www.katespadeoutlet.com/products/kendall-jelly-t-strap-sandal/KL418-403.html";

const NOT_FOUND = "NOT_FOUND";

async function safeEval(page, fn, fallback = NOT_FOUND) {
  try {
    return await page.evaluate(fn);
  } catch {
    return fallback;
  }
}

async function getActiveColor(page) {
  return await safeEval(page, () => {
    // active swatch wrapper is inside a <span title="...">
    const active = document.querySelector(".activeColorSwatch");
    if (active) {
      const span = active.closest("span[title]");
      return span ? span.getAttribute("title") : "NOT_FOUND";
    }

    // fallback: aria-checked="true"
    const checked = document.querySelector(
      '[data-qa="swatches_slide_swatch"][aria-checked="true"]'
    );
    if (checked) {
      const span = checked.closest("span[title]");
      return span ? span.getAttribute("title") : "NOT_FOUND";
    }

    return "NOT_FOUND";
  });
}

async function getAllColors(page) {
  return await safeEval(
    page,
    () => {
      const spans = Array.from(
        document.querySelectorAll(".color-variants span[title]")
      );
      const titles = spans
        .map((s) => (s.getAttribute("title") || "").trim())
        .filter(Boolean);

      // unique
      return Array.from(new Set(titles));
    },
    []
  );
}

async function getSizes(page) {
  return await safeEval(
    page,
    () => {
      return Array.from(document.querySelectorAll(".product-size-button"))
        .map((b) => {
          const size = (b.innerText || "").trim();
          const unavailable = b.classList.contains("pdp-unavailable-size");
          return unavailable ? `${size} (Unavailable)` : size;
        })
        .filter(Boolean);
    },
    []
  );
}

async function clickColorByTitle(page, title) {
  // click the swatch whose parent span has title="..."
  const locator = page
    .locator(
      `.color-variants span[title="${title}"] [data-qa="swatches_slide_swatch"]`
    )
    .first();

  if ((await locator.count()) === 0) return false;

  await locator.click();

  // wait until active color becomes this title (AJAX update)
  await page.waitForFunction(
    (t) => {
      const active =
        document.querySelector(".activeColorSwatch") ||
        document.querySelector(
          '[data-qa="swatches_slide_swatch"][aria-checked="true"]'
        );

      if (!active) return false;
      const span = active.closest("span[title]");
      return span && span.getAttribute("title") === t;
    },
    title,
    { timeout: 15000 }
  );

  // sizes should be present after update
  await page.waitForSelector(".product-size-button", { timeout: 15000 });

  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(URL, { waitUntil: "domcontentloaded" });

  // optional: accept cookies popup if it blocks clicks (safe try)
  try {
    const acceptBtn = page.locator('button:has-text("Accept")').first();
    if (await acceptBtn.isVisible({ timeout: 1500 })) await acceptBtn.click();
  } catch {}

  const colors = await getAllColors(page);
  const activeColor = await getActiveColor(page);

  const results = [];

  // one-by-one: click each color, then read sizes
  for (const color of colors) {
    const ok = await clickColorByTitle(page, color);
    const sizes = ok ? await getSizes(page) : [NOT_FOUND];

    results.push({ color, sizes });
  }

  console.log(
    JSON.stringify(
      {
        url: URL,
        activeColor,
        colors,
        variants: results,
      },
      null,
      2
    )
  );

  await browser.close();
})();

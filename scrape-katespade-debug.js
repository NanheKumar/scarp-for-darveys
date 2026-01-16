// npm i playwright
// node scrape-katespade-debug.js
// Headless chahiye to: HEADLESS=1 node scrape-katespade-debug.js

const fs = require("fs");
const { chromium } = require("playwright");

const URL =
  "https://www.katespadeoutlet.com/products/kendall-jelly-t-strap-sandal/KL418-403.html";

const NOT_FOUND = "NOT_FOUND";

async function main() {
  const headless = process.env.HEADLESS === "1";

  const browser = await chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
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

  let mainStatus = "NA";
  page.on("response", (res) => {
    if (res.url() === page.url()) mainStatus = String(res.status());
  });

  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Try closing common consent/cookie overlays (safe tries)
  const possibleBtns = [
    'button:has-text("Accept")',
    'button:has-text("I Agree")',
    'button:has-text("Agree")',
    'button:has-text("Got it")',
    '[aria-label="Close"]',
    'button[aria-label="Close"]',
  ];

  for (const sel of possibleBtns) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click({ timeout: 2000 }).catch(() => {});
      }
    } catch {}
  }

  // Wait a little for React hydration
  await page.waitForTimeout(2000);

  const finalUrl = page.url();
  const title = await page.title().catch(() => "");

  // dump screenshot + html ALWAYS for debugging
  await page.screenshot({ path: "debug.png", fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => "");
  fs.writeFileSync("debug.html", html, "utf8");

  console.log("Final URL:", finalUrl);
  console.log("Page title:", title);
  console.log("Main status:", mainStatus);
  console.log("Saved: debug.png, debug.html");

  // ---- Now attempt extraction (only if PDP exists) ----
  const hasPdpTitle = await page
    .locator('[data-qa="pdp_txt_pdt_title"]')
    .count()
    .catch(() => 0);

  if (!hasPdpTitle) {
    console.log(
      JSON.stringify(
        { url: finalUrl, activeColor: NOT_FOUND, colors: [], variants: [] },
        null,
        2
      )
    );
    console.log("Browser will close in 20 seconds...");
    await page.waitForTimeout(20000); // 20 seconds

    await browser.close();
    return;
  }

  const activeColor = await page
    .locator('[data-qa="cm_txt_pdt_label_color"]')
    .first()
    .innerText()
    .then((t) => t.replace(/^Color:\s*/i, "").trim())
    .catch(() => NOT_FOUND);

  // Wait for swatches
  await page
    .waitForSelector('[data-qa="swatches_slide_swatch"]', { timeout: 15000 })
    .catch(() => {});

  const colors = await page
    .evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll('[data-qa="swatches_slide_swatch"]')
      );
      const titles = nodes
        .map((n) => {
          const span = n.closest("span[title]");
          return span ? (span.getAttribute("title") || "").trim() : "";
        })
        .filter(Boolean);
      return Array.from(new Set(titles));
    })
    .catch(() => []);

  const variants = [];

  for (const color of colors) {
    try {
      const swatch = page
        .locator(`span[title="${color}"] [data-qa="swatches_slide_swatch"]`)
        .first();

      if ((await swatch.count()) === 0) {
        variants.push({ color, sizes: [NOT_FOUND] });
        continue;
      }

      await swatch.click({ timeout: 15000 });

      // Wait till label updates to this color (ajax)
      await page
        .waitForFunction(
          (t) => {
            const el = document.querySelector(
              '[data-qa="cm_txt_pdt_label_color"]'
            );
            if (!el) return false;
            const txt = (el.innerText || "").trim().replace(/^Color:\s*/i, "");
            return txt === t;
          },
          color,
          { timeout: 20000 }
        )
        .catch(() => {});

      // Sizes
      const sizes = await page
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

      variants.push({ color, sizes });
    } catch {
      variants.push({ color, sizes: [NOT_FOUND] });
    }
  }

  console.log(
    JSON.stringify(
      {
        url: finalUrl,
        activeColor,
        colors,
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

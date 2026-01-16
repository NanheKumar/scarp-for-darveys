const { chromium } = require("playwright");

const URLS = [
  "https://www.stockfirmati.com/bags-and-accessories/wallets",
  "https://www.stockfirmati.com/d/34745/valentino-bags/bags/donna/valentino-bags-borsa-donna-rosa",
  "https://www.stockfirmati.com/d/13532/valentino-bags/bags/donna/valentino-bags-borsa-donna-bianco",
  "https://www.stockfirmati.com/d/26048/calvin-klein/shoulder-bag/uomo/calvin-klein-tracolla-uomo-nero",
  "https://www.stockfirmati.com/d/19037/calvin-klein/bags/uomo/calvin-klein-marsupio-uomo-nero",
];

const NOT_FOUND = "NOT_FOUND";

async function safeEval(page, fn) {
  try {
    return await page.evaluate(fn);
  } catch {
    return NOT_FOUND;
  }
}

async function scrapeOne(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // size_name: document.querySelectorAll('.stock-no-border span')[0].innerText
  const size_name = await safeEval(page, () => {
    const el = document.querySelectorAll(".stock-no-border span")[0];
    return el ? el.innerText.trim() : "NOT_FOUND";
  });

  // size: document.querySelector('.product-taglie').innerText
  const size = await safeEval(page, () => {
    const el = document.querySelector(".product-taglie");
    return el ? el.innerText.trim() : "NOT_FOUND";
  });

  // stock: document.querySelectorAll('.stock span')[1].innerText
  // if "Currently Not Available" => set it
  // if selector missing / error => fallback to table Availability
  let stock = await safeEval(page, () => {
    const el = document.querySelectorAll(".stock span")[1];
    return el ? el.innerText.trim() : "NOT_FOUND";
  });

  if (stock === "Currently Not Available") {
    // keep as is
  } else {
    // if NOT_FOUND or anything else where "Currently Not Available" not present,
    // fallback: Availability = .product-disponibilita
    const availability = await safeEval(page, () => {
      const el = document.querySelector(".product-disponibilita");
      return el ? el.innerText.trim() : "NOT_FOUND";
    });

    stock = availability; // requirement: use table availability when error / not found
  }

  return { url, size_name, size, stock };
}

async function startScraping() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const results = [];
  for (const url of URLS) {
    try {
      results.push(await scrapeOne(page, url));
    } catch (e) {
      results.push({
        url,
        size_name: NOT_FOUND,
        size: NOT_FOUND,
        stock: NOT_FOUND,
        error: String(e),
      });
    }
  }

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
}

startScraping();

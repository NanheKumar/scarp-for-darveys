//npm init -y
//npm i axios cheerio

// node michaelkors-scrape.js

const axios = require("axios");
const cheerio = require("cheerio");

const API_KEY = "a089a1e20a5c377aea41f6a713782a43";

// const URL =
//   "https://www.michaelkors.com/carson-large-signature-logo-convertible-crossbody-bag/35S5S2ZC7B.html";

const URL =
  "https://www.michaelkors.com/marilyn-medium-woven-satchel/35R6G6AS2Y.html";
function cleanText(t = "") {
  return String(t).replace(/\s+/g, " ").trim();
}

(async () => {
  const apiUrl = `http://api.scraperapi.com?api_key=${API_KEY}&url=${encodeURIComponent(
    URL
  )}&country_code=us`;

  const res = await axios.get(apiUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  const html = res.data;
  const $ = cheerio.load(html);

  // ---- basic ----
  const brand =
    cleanText($(".product-brand.product-row").first().text()) || "NOT_FOUND";
  const title = cleanText($("h1.product-name").first().text()) || "NOT_FOUND";

  // ---- price block (list + sales + discount) ----
  const original_price =
    cleanText($(".default-price .list .value").first().text()) || "NOT_FOUND";

  const sale_price =
    cleanText($(".default-price .sales .value").first().text()) ||
    cleanText($(".default-price .sales .value").last().text()) ||
    "NOT_FOUND";

  const discount =
    cleanText($(".default-price__discount").first().text()) || "NOT_FOUND";

  // ---- active/selected color ----
  const activeColor =
    cleanText($(".display-color-name").first().text()) || "NOT_FOUND";

  // ---- all colors ----
  const colors = [];
  $(
    ".color-attribute-value button.color-attribute span.color-value[title]"
  ).each((_, el) => {
    const name = cleanText($(el).attr("title"));
    if (name) colors.push(name);
  });

  const uniqColors = [...new Set(colors)];

  // ---- Add to Bag / Notify Me status ----
  // agar page me NOTIFY ME button visible hai to out_of_stock,
  // nahi to Add to Bag hai to in_stock
  const hasNotify = $(".notify-me-btn").length > 0;
  const hasAddToBag =
    $(".add-to-cart-label-js").filter((_, el) =>
      cleanText($(el).text()).toLowerCase().includes("add to bag")
    ).length > 0;

  let cta = "NOT_FOUND";
  if (hasNotify) cta = "NOTIFY ME";
  else if (hasAddToBag) cta = "Add to Bag";

  const output = {
    url: URL,
    brand,
    title,
    activeColor,
    colors: uniqColors,
    pricing: {
      original_price,
      sale_price,
      discount,
    },
    cta,
  };

  console.log(JSON.stringify(output, null, 2));
})();

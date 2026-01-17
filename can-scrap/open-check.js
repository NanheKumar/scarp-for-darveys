//https://www.michaelkors.com/on/demandware.store/Sites-mk_us-Site/en_US/Product-Variation?pid=77A7161M42
//https://www.michaelkors.com/on/demandware.store/Sites-mk_us-Site/en_US/Product-Variation?pid=35R6G6AS2Y
//https://www.michaelkors.com/on/demandware.store/Sites-mk_us-Site/en_US/Product-Variation?dwvar_35R6G6AS2Y_color=0001&dwvar_35R6G6AS2Y_size=NS&pid=35R6G6AS2Y&quantity=1
//const { chromium } = require("playwright"); //if you want use require
import { chromium } from "playwright"; // If   "type": "module", in package.json
const URL =
  "https://www.coachoutlet.com/products/nolita-19-in-signature-canvas/CW426.html?frp=CW426+IMXDMhttps://www.coachoutlet.com/api/products/nolita-19/CDN25-SV%2FIZ.html?__v__=HtQ8OIoV2QoZmOhIgY1YY";

(async () => {
  const browser = await chromium.launch({ headless: false });

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

  await page.goto(URL, { waitUntil: "domcontentloaded" });

  console.log("Final URL:", page.url());

  await page.waitForTimeout(30000);
  await browser.close();
})();

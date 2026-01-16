// npm i playwright
// node can-scrap.js
// HEADLESS=1 node can-scrap.js

/*
Access Denied
https://www.katespadeoutlet.com/products/kendall-jelly-t-strap-sandal/KL418-403.html
https://www.coachoutlet.com/products/snap-wallet/C2862.html?frp=C2862%20IMBLK
https://www.neimanmarcus.com/p/emporio-armani-basic-flat-front-wool-trousers-prod205630312?childItemId=NMN5460_&navpath=cat000000_cat000470_cat14120827&page=0&position=88
https://www.katespadeoutlet.com/products/picnic-woven-ruffle-midi-dress/KC382.html?frp=KC382%20VK3%20%20S
https://www.saksoff5th.com/product/hugo-regular-fit-jeans-0400011091791.html

Need Login
https://eic.giglio.com/eng/shoes-men_sneakers-kenzo-fd55sn020f73.html?cSel=002
https://b2b.italjapan.it/product/JC1L312L0015

Open In Browser
https://www.6pm.com/p/womens-calvin-klein-presley-black/product/10008224/color/3
https://www.ashford.com/ferragamo-sf1012s-214.html
https://www.belk.com/p/lucky-brand-venice-burnout-v-neck-t-shirt/32039537M62750.html
https://betseyjohnson.com/collections/handbags/products/bj35440n-pink
https://www.b-exit.com/hi-in/products/versace-jeans-stivaletti-couture-donna-camoscio-marrone-cognac-f65407-718-4287?variant=45321324593417
https://www.dillards.com/p/givenchy-rose-gold-stud-earrings/503497959
https://www.glamood.com/catalog.htm?search=P323003
https://www.dsw.com/product/betsey-johnson-nakia-sandal/570429?activeColor=713
https://www.ebay.com/itm/204453106824?_skw=ralph+lauren+earrings&itmmeta=01JRJ5VJYVVMKZ7QCCS1S9C1FM&hash=item2f9a5ad488%3Ag%3AwgAAAOSwyXdk-Pvs&LH_ItemCondition=3
https://factory.jcrew.com/p/mens/categories/clothing/tees/v-neck-tees/washed-jersey-v-neck-tee/F0910?display=standard&fit=Classic&colorProductCode=F0910
https://www.fashionrooms.com/en/men/shoes/boots/dolce-gabbana/all-weather-siracusa-boots-brown?c=28
https://www.jomashop.com/marc-jacobs-the-cuff-quartz-ladies-watch-mj0120190883.html
https://www.macys.com/shop/product/michael-michael-kors-logo-mini-nylon-crossbody-with-webbing-strap?ID=16401832
https://www.michaelkors.global/in/en/jet-set-medium-pebbled-leather-crossbody-bag/32F7GGNM8L.html?astc=true&dwvar_32F7GGNM8L_color=0001
https://www.nordstromrack.com/s/ugg-alder-faux-shearling-lined-suede-slipper-men/6039754
https://poshmark.com/listing/True-Religion-Mens-Monogram-Boxer-Brief-Underwear-in-Red-5d73ded653f5e71d4a18b9b4
https://www.ralphlauren.com/men-accessories-bags/tiger-patch-camo-canvas-waistpack/631377.html?cgid=men-accessories-bags
https://www.rebeccaminkoff.com/collections/handbags/products/amour-top-handle-satchel-ch24iamsat-nude
https://www.stockfirmati.com/d/557/karl-lagerfeld-beachwear/sea/donna/karl-lagerfeld-beachwear-costume-intero-donna-nero
https://www.strikecalzature.it/shop/donna/stivaletti-bassi-donna/balmain-donna-stivaletto-aperto-in-punta-tima-con-hardware-dorato/
https://b2b.timeshop24.com/versace-vehc00519-virtus.html
https://ventutto.com/collections/sunglasses-for-her/products/calvin-klein-ck2161s-060-shiny-gunmetal-round-sunglasses
https://poshmark.com/listing/True-Religion-Mens-Geno-Slim-Fit-Jeans-in-Boost-Blue-5dc5c3d395676b58102a8740

*/
const fs = require("fs");
const { chromium } = require("playwright");

const URL =
  "https://www.michaelkors.global/in/en/jet-set-medium-pebbled-leather-crossbody-bag/32F7GGNM8L.html?astc=true&dwvar_32F7GGNM8L_color=0001";

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

  // Save debug files
  await page
    .screenshot({ path: "can-scrap.png", fullPage: true })
    .catch(() => {});
  const html = await page.content().catch(() => "");
  fs.writeFileSync("can-scrap.html", html, "utf8");

  const finalUrl = page.url();
  const title = await page.title().catch(() => "");

  console.log("Final URL:", finalUrl);
  console.log("Page Title:", title);
  console.log("Main Status:", mainStatus);
  console.log("Saved: can-scrap.png, can-scrap.html");

  console.log("Browser will stay open for 20 seconds...");
  await page.waitForTimeout(20000);

  await browser.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

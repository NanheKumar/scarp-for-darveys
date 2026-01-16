const axios = require("axios");

const API_KEY = "a089a1e20a5c377aea41f6a713782a43";
const TARGET_URL =
  "https://www.michaelkors.com/carson-large-signature-logo-convertible-crossbody-bag/35S5S2ZC7B.html";

(async () => {
  const url = `http://api.scraperapi.com?api_key=${API_KEY}&url=${encodeURIComponent(
    TARGET_URL
  )}&country_code=us`;

  const res = await axios.get(url);

  console.log("Final URL:", res.request.res.responseUrl);
  console.log("HTML length:", res.data.length);
})();

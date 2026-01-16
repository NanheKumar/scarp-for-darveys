// test-api.js
// Run: node test-api.js

const url =
  "https://www.katespadeoutlet.com/api/stores/get-stores?products=KL418+XT6++6+++B&zipCode=110043&startFrom=0&__v__=7DVfuYAP";

(async () => {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json,text/plain,*/*",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    console.log("HTTP:", res.status, res.statusText);
    console.log("Final URL:", res.url);

    const text = await res.text();
    console.log("Body (first 500 chars):");
    console.log(text.slice(0, 500));
  } catch (e) {
    console.error("ERROR:", e.message);
  }
})();

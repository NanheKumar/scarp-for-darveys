/**
 *  Multiple Colors With Multiple Sizes
 * Michael Kors / Kate Spade (Demandware) Product Variation Extractor
 * Goal: Build Color x Size matrix (price, stock, CTA) using JSON APIs (no scraping)
 *
 * Works with:
 * - Product-NonCachedAttributes (to get colors/sizes list)
 * - Product-Variation (to get exact stock/CTA/price per color-size)
 *
 * Node.js: v18+ (global fetch). If Node < 18, install undici and import fetch.
 *
 * Usage:
 *   node mk_matrix_v1.js 77A7161M42
 *
 * Optional:
 *   node mk_matrix_v1.js 77A7161M42 --site mk_us --locale en_US --concurrency 6
 */

const DEFAULTS = {
  site: "mk_us", // Sites-mk_us-Site
  locale: "en_US",
  quantity: 1,
  concurrency: 6,
  timeoutMs: 25000,
  retries: 2,
  retryDelayMs: 800,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS, pid: null };
  const rest = argv.slice(2);

  if (!rest.length) return args;

  args.pid = rest[0];

  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--site") args.site = rest[++i];
    else if (a === "--locale") args.locale = rest[++i];
    else if (a === "--concurrency")
      args.concurrency = Number(rest[++i] || args.concurrency);
    else if (a === "--timeoutMs")
      args.timeoutMs = Number(rest[++i] || args.timeoutMs);
    else if (a === "--retries")
      args.retries = Number(rest[++i] || args.retries);
  }
  return args;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ctaFrom(product) {
  const available = Boolean(product?.available);
  const notify = Boolean(product?.isNotifyMeActive);
  const label =
    product?.soldOutLabel?.pdp || (available ? "Add to Bag" : "Notify Me");

  // Rule:
  // available true + notify false => Add to Bag
  // else => Notify Me / OOS
  const type = available && !notify ? "ADD_TO_BAG" : "NOTIFY_ME";
  return { type, label, available, isNotifyMeActive: notify };
}

function pickPrice(product) {
  const p = product?.price || {};
  return {
    sales: p?.sales?.value ?? null,
    sales_formatted: p?.sales?.formatted ?? null,
    list: p?.list?.value ?? null,
    list_formatted: p?.list?.formatted ?? null,
    discount_percent: p?.discount ?? null,
    currency: p?.sales?.currency ?? p?.list?.currency ?? null,
  };
}

function demandwareBase({ site, locale }) {
  return `https://www.michaelkors.com/on/demandware.store/Sites-${site}-Site/${locale}`;
}

function nonCachedUrl({ site, locale, pid, color }) {
  // NOTE: Endpoint name can vary by implementation.
  // You already captured "Product-NonCachedAttributes" response in your earlier logs.
  // If your exact endpoint path differs, change it here.
  //
  // Common pattern seen:
  //   /Product-NonCachedAttributes?pid=...&dwvar_{pid}_color=...
  //
  const base = demandwareBase({ site, locale });
  const qp = new URLSearchParams();
  qp.set("pid", pid);
  if (color) qp.set(`dwvar_${pid}_color`, color);
  return `${base}/Product-NonCachedAttributes?${qp.toString()}`;
}

function variationUrl({ site, locale, pid, color, size, quantity }) {
  const base = demandwareBase({ site, locale });
  const qp = new URLSearchParams();
  qp.set(`dwvar_${pid}_color`, color);
  qp.set(`dwvar_${pid}_size`, size);
  qp.set("pid", pid);
  qp.set("quantity", String(quantity ?? 1));
  return `${base}/Product-Variation?${qp.toString()}`;
}

async function fetchJson(url, { timeoutMs, retries, retryDelayMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            // These headers help mimic real browser calls (often reduces blocks)
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
            referer: "https://www.michaelkors.com/",
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(
            `HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`,
          );
        }

        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json") && !ct.includes("text/json")) {
          // Some deployments still send JSON with text/html; we try parse anyway.
        }

        return await res.json();
      } catch (e) {
        lastErr = e;
        if (attempt < retries) await sleep(retryDelayMs * (attempt + 1));
      }
    }
    throw lastErr;
  } finally {
    clearTimeout(timer);
  }
}

function extractVariationAttributes(product) {
  const attrs = Array.isArray(product?.variationAttributes)
    ? product.variationAttributes
    : [];
  const colorAttr = attrs.find((a) => (a?.id || a?.attributeId) === "color");
  const sizeAttr = attrs.find((a) => (a?.id || a?.attributeId) === "size");

  const colors = Array.isArray(colorAttr?.values)
    ? colorAttr.values
        .filter((v) => v?.selectable !== false) // keep selectable
        .map((v) => ({
          id: String(v?.value ?? v?.id ?? ""),
          name: v?.displayValue ?? null,
          inStockHint: Boolean(v?.inStock),
          swatch:
            v?.images?.swatch?.[0]?.absURL ||
            v?.images?.swatch?.[0]?.url ||
            null,
        }))
        .filter((c) => c.id)
    : [];

  const sizes = Array.isArray(sizeAttr?.values)
    ? sizeAttr.values
        .filter((v) => v?.selectable !== false) // keep selectable
        .map((v) => ({
          id: String(v?.value ?? v?.id ?? ""),
          label: v?.displayValue ?? null,
          inStockHint: Boolean(v?.inStock),
        }))
        .filter((s) => s.id)
    : [];

  return { colors, sizes };
}

/** Simple concurrency pool */
async function mapLimit(items, limit, mapper) {
  const out = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const my = idx++;
      if (my >= items.length) return;
      out[my] = await mapper(items[my], my);
    }
  }

  const workers = Array.from({ length: Math.max(1, limit) }, () => worker());
  await Promise.all(workers);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.pid) {
    console.error(
      "Usage: node mk_matrix.js <PID> [--site mk_us] [--locale en_US] [--concurrency 6]",
    );
    process.exit(1);
  }

  const {
    pid,
    site,
    locale,
    concurrency,
    timeoutMs,
    retries,
    retryDelayMs,
    quantity,
  } = args;

  // 1) Base call to get colors + sizes list
  // Pick any color (or none). If the endpoint requires a color, you can first call
  // Product-Variation without size to discover colors, but generally NonCached gives it.
  const baseUrl = nonCachedUrl({ site, locale, pid, color: "" });

  const baseJson = await fetchJson(baseUrl, {
    timeoutMs,
    retries,
    retryDelayMs,
  });

  const baseProduct = baseJson?.product || {};
  const { colors, sizes } = extractVariationAttributes(baseProduct);

  if (!colors.length || !sizes.length) {
    console.error(
      "Could not extract colors/sizes from NonCachedAttributes response.",
    );
    console.error(
      "Check endpoint URL in nonCachedUrl() and whether response contains variationAttributes.",
    );
    process.exit(2);
  }

  // 2) Build tasks for (color, size) combinations
  const tasks = [];
  for (const c of colors) {
    for (const s of sizes) {
      tasks.push({ color: c, size: s });
    }
  }

  // 3) Fetch each combination via Product-Variation
  const results = await mapLimit(
    tasks,
    concurrency,
    async ({ color, size }) => {
      const url = variationUrl({
        site,
        locale,
        pid,
        color: color.id,
        size: size.id,
        quantity,
      });

      try {
        const j = await fetchJson(url, { timeoutMs, retries, retryDelayMs });
        const p = j?.product || {};
        const cta = ctaFrom(p);
        const price = pickPrice(p);

        return {
          color_id: color.id,
          color_name: color.name,
          size: size.id,
          sku: String(p?.selectedVariationProductId ?? p?.id ?? ""),
          price,
          cta,
        };
      } catch (e) {
        return {
          color_id: color.id,
          color_name: color.name,
          size: size.id,
          error: String(e?.message || e),
        };
      }
    },
  );

  // 4) Reshape into matrix JSON
  const matrix = {};
  for (const row of results) {
    const cid = row.color_id;
    if (!matrix[cid]) {
      matrix[cid] = {
        color_id: cid,
        color_name: row.color_name,
        sizes: {},
      };
    }
    matrix[cid].sizes[row.size] = row;
  }

  const output = {
    pid,
    site,
    locale,
    extracted_at: new Date().toISOString(),
    colors: colors,
    sizes: sizes,
    matrix: Object.values(matrix),
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

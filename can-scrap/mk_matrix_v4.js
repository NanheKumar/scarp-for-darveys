/**
 * Michael Kors / Kate Spade (Demandware) Product Variation Extractor
 * Output: JSON + CSV
 *
 * ✅ Handles:
 *   1) Multiple colors + multiple sizes
 *   2) Multiple colors + NO size attribute (bags/accessories) -> fallback size = "NS"
 *
 * Node.js v18+ recommended.
 *
 * Usage:
 *   node mk_matrix_v4.js 77T6831M42
 *   node mk_matrix_v4.js 77A7161M42 --out ./out
 */

import fs from "fs";
import path from "path";

const DEFAULTS = {
  site: "mk_us",
  locale: "en_US",
  quantity: 1,
  concurrency: 6,
  timeoutMs: 25000,
  retries: 2,
  retryDelayMs: 800,
  outDir: "./out",
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
    else if (a === "--quantity")
      args.quantity = Number(rest[++i] || args.quantity);
    else if (a === "--out") args.outDir = rest[++i] || args.outDir;
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

function pickNameBrand(product) {
  const productName = product?.productName ?? null;
  const brand =
    product?.michael_kors_brand_name || product?.brand || "Michael Kors";
  return { productName, brand };
}

function demandwareBase({ site, locale }) {
  return `https://www.michaelkors.com/on/demandware.store/Sites-${site}-Site/${locale}`;
}

function nonCachedUrl({ site, locale, pid, color }) {
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
        .filter((v) => v?.selectable !== false)
        .map((v) => ({
          id: String(v?.value ?? v?.id ?? ""),
          name: v?.displayValue ?? null,
          inStockHint: v?.inStock ?? null,
          swatch:
            v?.images?.swatch?.[0]?.absURL ||
            v?.images?.swatch?.[0]?.url ||
            null,
        }))
        .filter((c) => c.id)
    : [];

  const hasSizeAttribute = Boolean(
    Array.isArray(sizeAttr?.values) && sizeAttr.values.length,
  );

  const sizes = hasSizeAttribute
    ? sizeAttr.values
        .filter((v) => v?.selectable !== false)
        .map((v) => ({
          id: String(v?.value ?? v?.id ?? ""),
          label: v?.displayValue ?? null,
          inStockHint: v?.inStock ?? null,
        }))
        .filter((s) => s.id)
    : [{ id: "NS", label: "NS", inStockHint: null }];

  return { colors, sizes, hasSizeAttribute };
}

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCSVRows(flatRows) {
  const headers = [
    "pid",
    "product_name",
    "brand",
    "site",
    "locale",
    "color_id",
    "color_name",
    "size_id",
    "size_label",
    "sku",
    "UPC",
    "availableForInStorePickup",
    "cta_type",
    "cta_label",
    "available",
    "notify_me_active",
    "sales_value",
    "sales_formatted",
    "list_value",
    "list_formatted",
    "discount_percent",
    "currency",
    "error",
  ];

  const lines = [];
  lines.push(headers.join(","));

  for (const r of flatRows) {
    const row = headers.map((h) => csvEscape(r[h]));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.pid) {
    console.error("Usage: node mk_matrix.js <PID> [--out ./out]");
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
    outDir,
  } = args;

  ensureDir(outDir);

  // Base call
  const baseUrl = nonCachedUrl({ site, locale, pid, color: "" });
  const baseJson = await fetchJson(baseUrl, {
    timeoutMs,
    retries,
    retryDelayMs,
  });
  const baseProduct = baseJson?.product || {};

  const { colors, sizes, hasSizeAttribute } =
    extractVariationAttributes(baseProduct);

  if (!colors.length) {
    console.error(
      "Could not extract colors from NonCachedAttributes response.",
    );
    process.exit(2);
  }

  let { productName, brand } = pickNameBrand(baseProduct);

  // Fallback to one variation if name missing
  if (!productName) {
    const fallbackColor = colors[0]?.id || "0001";
    const fallbackSize = sizes[0]?.id || "NS";
    const vUrl = variationUrl({
      site,
      locale,
      pid,
      color: fallbackColor,
      size: fallbackSize,
      quantity,
    });
    const vJson = await fetchJson(vUrl, { timeoutMs, retries, retryDelayMs });
    const nb = pickNameBrand(vJson?.product || {});
    productName = productName || nb.productName;
    brand = brand || nb.brand;
  }

  // Tasks
  const tasks = [];
  for (const c of colors)
    for (const s of sizes) tasks.push({ color: c, size: s });

  const results = await mapLimit(
    tasks,
    concurrency,
    async ({ color, size }) => {
      const url = variationUrl({
        site,
        locale,
        pid,
        color: color.id,
        size: size.id || "NS",
        quantity,
      });

      try {
        const j = await fetchJson(url, { timeoutMs, retries, retryDelayMs });
        const p = j?.product || {};
        const cta = ctaFrom(p);
        const price = pickPrice(p);

        return {
          ok: true,
          color_id: color.id,
          color_name: color.name,
          size: size.id || "NS",
          size_label: size.label || size.id || "NS",
          sku: String(p?.selectedVariationProductId ?? p?.id ?? ""),
          upc: p?.UPC ?? null,
          availableForInStorePickup: p?.availableForInStorePickup ?? null,
          price,
          cta,
        };
      } catch (e) {
        return {
          ok: false,
          color_id: color.id,
          color_name: color.name,
          size: size.id || "NS",
          size_label: size.label || size.id || "NS",
          error: String(e?.message || e),
        };
      }
    },
  );

  // Matrix JSON
  const matrix = {};
  for (const row of results) {
    const cid = row.color_id;
    if (!matrix[cid]) {
      matrix[cid] = { color_id: cid, color_name: row.color_name, sizes: {} };
    }
    matrix[cid].sizes[row.size] = row;
  }

  const output = {
    pid,
    product_name: productName,
    brand,
    site,
    locale,
    extracted_at: new Date().toISOString(),
    has_size_attribute: hasSizeAttribute,
    colors,
    sizes,
    matrix: Object.values(matrix),
  };

  // ✅ Write JSON
  const jsonPath = path.join(outDir, `${pid}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2), "utf-8");

  // ✅ Build flat rows for CSV
  const flatRows = results.map((r) => ({
    pid,
    product_name: productName,
    brand,
    site,
    locale,
    color_id: r.color_id,
    color_name: r.color_name,
    size_id: r.size,
    size_label: r.size_label,
    sku: r.ok ? r.sku : "",
    UPC: r.ok ? (r.upc ?? "") : "",
    availableForInStorePickup: r.ok ? (r.availableForInStorePickup ?? "") : "",
    cta_type: r.ok ? r.cta?.type : "",
    cta_label: r.ok ? r.cta?.label : "",
    available: r.ok ? r.cta?.available : "",
    notify_me_active: r.ok ? r.cta?.isNotifyMeActive : "",
    sales_value: r.ok ? r.price?.sales : "",
    sales_formatted: r.ok ? r.price?.sales_formatted : "",
    list_value: r.ok ? r.price?.list : "",
    list_formatted: r.ok ? r.price?.list_formatted : "",
    discount_percent: r.ok ? r.price?.discount_percent : "",
    currency: r.ok ? r.price?.currency : "",
    error: r.ok ? "" : r.error,
  }));

  // ✅ Write CSV
  const csvPath = path.join(outDir, `${pid}.csv`);
  fs.writeFileSync(csvPath, toCSVRows(flatRows), "utf-8");

  // Print JSON to stdout (optional)
  console.log(JSON.stringify(output, null, 2));

  // Log files
  console.error(`Saved JSON: ${jsonPath}`);
  console.error(`Saved CSV : ${csvPath}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

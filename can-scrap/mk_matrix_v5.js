/**
 * Bulk Michael Kors (Demandware) Variation Extractor
 * Input: CSV (sku,url)
 * Output: ONE combined JSON + ONE combined CSV
 *
 * Usage:
 *   node mk_matrix_v5.js --in ./input.csv --out ./out
 *
 * Output files:
 *   ./out/bulk.json
 *   ./out/bulk.csv
 */

import fs from "fs";
import path from "path";

const DEFAULTS = {
  site: "mk_us",
  locale: "en_US",
  quantity: 1,
  concurrency: 6, // per-product combos concurrency (color x size)
  productConcurrency: 2, // how many products to process in parallel
  timeoutMs: 25000,
  retries: 2,
  retryDelayMs: 800,
  inFile: "./input.csv",
  outDir: "./out",
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  const rest = argv.slice(2);

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--site") args.site = rest[++i] || args.site;
    else if (a === "--locale") args.locale = rest[++i] || args.locale;
    else if (a === "--concurrency")
      args.concurrency = Number(rest[++i] || args.concurrency);
    else if (a === "--productConcurrency")
      args.productConcurrency = Number(rest[++i] || args.productConcurrency);
    else if (a === "--timeoutMs")
      args.timeoutMs = Number(rest[++i] || args.timeoutMs);
    else if (a === "--retries")
      args.retries = Number(rest[++i] || args.retries);
    else if (a === "--quantity")
      args.quantity = Number(rest[++i] || args.quantity);
    else if (a === "--in") args.inFile = rest[++i] || args.inFile;
    else if (a === "--out") args.outDir = rest[++i] || args.outDir;
  }
  return args;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseSimpleCSV(text) {
  // Simple CSV parser for your format: sku,url,(optional columns)
  // Handles commas inside quotes.
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [];

  const rows = [];
  const header = splitCSVLine(lines[0]).map((h) => h.trim());
  const skuIdx = header.findIndex((h) => h.toLowerCase() === "sku");
  const urlIdx = header.findIndex((h) => h.toLowerCase() === "url");

  if (skuIdx === -1 || urlIdx === -1) {
    throw new Error('Input CSV must have headers: "sku,url"');
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const sku = (cols[skuIdx] ?? "").trim();
    const url = (cols[urlIdx] ?? "").trim();
    if (!sku || !url) continue;
    rows.push({ sku, url });
  }
  return rows;
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function extractPidFromUrl(url) {
  // Examples:
  // https://www.michaelkors.com/.../35S5S2ZC7B.html?astc=true
  // https://www.michaelkors.com/.../35R4STVF6L.html?astc=true&dwvar_...
  const m = url.match(/\/([A-Z0-9]{8,12})\.html/i);
  if (m?.[1]) return m[1].toUpperCase();

  // fallback: try last path segment without .html
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() || "";
    const m2 = seg.match(/^([A-Z0-9]{8,12})(?:\.html)?$/i);
    if (m2?.[1]) return m2[1].toUpperCase();
  } catch (_) {}

  return null;
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
          swatch_url:
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

function buildBulkCSV(flatRows) {
  const headers = [
    "input_sku",
    "input_url",
    "pid",
    "product_name",
    "brand",
    "site",
    "locale",
    "has_size_attribute",
    "color_id",
    "color_name",
    "swatch_url",
    "size_id",
    "size_label",
    "variant_sku",
    "UPC",
    "availableForInStorePickup",
    "selectedProductUrlNoQuantity",
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

  const lines = [headers.join(",")];
  for (const r of flatRows) {
    const row = headers.map((h) => csvEscape(r[h]));
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

async function extractOneProduct({ pid, inputSku, inputUrl, args }) {
  const {
    site,
    locale,
    concurrency,
    timeoutMs,
    retries,
    retryDelayMs,
    quantity,
  } = args;

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
    return {
      pid,
      inputSku,
      inputUrl,
      ok: false,
      error: "Could not extract colors from NonCachedAttributes response.",
    };
  }

  let { productName, brand } = pickNameBrand(baseProduct);

  // fallback name/brand
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

  // tasks for matrix
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
          pid,
          input_sku: inputSku,
          input_url: inputUrl,

          product_name: productName,
          brand,
          site,
          locale,
          has_size_attribute: hasSizeAttribute,

          color_id: color.id,
          color_name: color.name,
          swatch_url: color.swatch_url || "",

          size_id: size.id || "NS",
          size_label: size.label || size.id || "NS",

          variant_sku: String(p?.selectedVariationProductId ?? p?.id ?? ""),
          UPC: p?.UPC ?? "",
          availableForInStorePickup: p?.availableForInStorePickup ?? "",
          selectedProductUrlNoQuantity: p?.selectedProductUrlNoQuantity ?? "",

          cta_type: cta.type,
          cta_label: cta.label,
          available: cta.available,
          notify_me_active: cta.isNotifyMeActive,

          sales_value: price.sales ?? "",
          sales_formatted: price.sales_formatted ?? "",
          list_value: price.list ?? "",
          list_formatted: price.list_formatted ?? "",
          discount_percent: price.discount_percent ?? "",
          currency: price.currency ?? "",

          error: "",
        };
      } catch (e) {
        return {
          ok: false,
          pid,
          input_sku: inputSku,
          input_url: inputUrl,
          product_name: productName,
          brand,
          site,
          locale,
          has_size_attribute: hasSizeAttribute,
          color_id: color.id,
          color_name: color.name,
          swatch_url: color.swatch_url || "",
          size_id: size.id || "NS",
          size_label: size.label || size.id || "NS",
          variant_sku: "",
          UPC: "",
          availableForInStorePickup: "",
          selectedProductUrlNoQuantity: "",
          cta_type: "",
          cta_label: "",
          available: "",
          notify_me_active: "",
          sales_value: "",
          sales_formatted: "",
          list_value: "",
          list_formatted: "",
          discount_percent: "",
          currency: "",
          error: String(e?.message || e),
        };
      }
    },
  );

  // grouped JSON output per pid (matrix)
  const matrix = {};
  for (const row of results) {
    const cid = row.color_id;
    if (!matrix[cid])
      matrix[cid] = {
        color_id: cid,
        color_name: row.color_name,
        swatch_url: row.swatch_url,
        sizes: {},
      };
    matrix[cid].sizes[row.size_id] = row;
  }

  return {
    ok: true,
    pid,
    input_sku: inputSku,
    input_url: inputUrl,
    product_name: productName,
    brand,
    site,
    locale,
    extracted_at: new Date().toISOString(),
    has_size_attribute: hasSizeAttribute,
    colors,
    sizes,
    matrix: Object.values(matrix),
    flatRows: results,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  ensureDir(args.outDir);

  const csvText = fs.readFileSync(args.inFile, "utf-8");
  const items = parseSimpleCSV(csvText);

  if (!items.length) {
    console.error("No rows found in input CSV.");
    process.exit(2);
  }

  // build jobs
  const jobs = items
    .map((it) => {
      const pid = extractPidFromUrl(it.url);
      return {
        inputSku: it.sku,
        inputUrl: it.url,
        pid,
      };
    })
    .map((j) => ({
      ...j,
      pid: j.pid || null,
    }));

  const validJobs = jobs.filter((j) => j.pid);
  const invalidJobs = jobs.filter((j) => !j.pid);

  if (invalidJobs.length) {
    console.error(
      `Skipped ${invalidJobs.length} rows (could not parse pid from url).`,
    );
  }

  const bulk = [];
  const bulkFlatRows = [];

  // process products with limited concurrency
  const processed = await mapLimit(
    validJobs,
    args.productConcurrency,
    async (job) => {
      try {
        const one = await extractOneProduct({
          pid: job.pid,
          inputSku: job.inputSku,
          inputUrl: job.inputUrl,
          args,
        });
        return one;
      } catch (e) {
        return {
          ok: false,
          pid: job.pid,
          input_sku: job.inputSku,
          input_url: job.inputUrl,
          error: String(e?.message || e),
        };
      }
    },
  );

  for (const p of processed) {
    bulk.push(p);
    if (p?.flatRows?.length) bulkFlatRows.push(...p.flatRows);
  }

  // write combined JSON
  const jsonPath = path.join(args.outDir, `bulk.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      { extracted_at: new Date().toISOString(), products: bulk },
      null,
      2,
    ),
    "utf-8",
  );

  // write combined CSV
  const csvPath = path.join(args.outDir, `bulk.csv`);
  fs.writeFileSync(csvPath, buildBulkCSV(bulkFlatRows), "utf-8");

  // summary
  const okCount = processed.filter((p) => p.ok).length;
  const failCount = processed.filter((p) => !p.ok).length;
  const rowCount = bulkFlatRows.length;

  console.error(`Products OK   : ${okCount}`);
  console.error(`Products Fail : ${failCount}`);
  console.error(`CSV Rows      : ${rowCount}`);
  console.error(`Saved JSON    : ${jsonPath}`);
  console.error(`Saved CSV     : ${csvPath}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(__dirname, "public");
const DATA_ROOT = process.env.DATA_ROOT ? path.resolve(process.env.DATA_ROOT) : ROOT;
const OUTPUT_ROOT = path.join(DATA_ROOT, "\u7ba1\u7406\u753b\u9762_\u751f\u6210");
const APPROVED_ROOT = path.join(DATA_ROOT, "\u7ba1\u7406\u753b\u9762_\u63a1\u7528\u6e08\u307f");
const DEFAULT_DELIVERY_ROOT = process.platform === "win32"
  ? "\\\\LS220DD5E\\share\\\u30aa\u30ea\u30b8\u30ca\u30eb\u8a9e\u9332\u30c7\u30b6\u30a4\u30f3\u81ea\u52d5\u751f\u6210"
  : path.join(DATA_ROOT, "\u7d0d\u54c1\u30c7\u30fc\u30bf");
const DELIVERY_ROOT = process.env.DELIVERY_ROOT || DEFAULT_DELIVERY_ROOT;
const DECISIONS_PATH = path.join(DATA_ROOT, "\u7ba1\u7406\u753b\u9762_\u63a1\u7528\u30e1\u30e2.json");
const PYTHON = process.env.PYTHON || "python";
const BASIC_USER = process.env.BASIC_USER || "";
const BASIC_PASSWORD = process.env.BASIC_PASSWORD || "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function authorized(req) {
  if (!BASIC_USER || !BASIC_PASSWORD) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf-8");
  return decoded === `${BASIC_USER}:${BASIC_PASSWORD}`;
}

function requireAuth(res) {
  res.writeHead(401, {
    "content-type": "text/plain; charset=utf-8",
    "www-authenticate": 'Basic realm="goroku-admin"',
  });
  res.end("\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002");
}

function safeSlug(value) {
  return String(value || "goroku")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "goroku";
}

function folderName(customerName, orderNumber) {
  const customer = safeSlug(customerName || "\u304a\u5ba2\u69d8\u540d\u672a\u5165\u529b");
  const order = safeSlug(orderNumber || "\u6ce8\u6587\u756a\u53f7\u672a\u5165\u529b");
  return `${customer}_${order}`;
}

async function readJsonBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

async function listPngs(dir, webPrefix) {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort()
    .map((name) => {
      const base = name.replace(/\.png$/i, "");
      return {
        name,
        url: `${webPrefix}/${encodeURIComponent(name)}`,
        svgName: `${base}.svg`,
        svgUrl: `${webPrefix}/${encodeURIComponent(`${base}.svg`)}`,
      };
    });
}

async function handleGenerate(req, res) {
  try {
    const body = await readJsonBody(req);
    const lines = String(body.text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return json(res, 400, { error: "\u8a9e\u9332\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002" });

    const title = body.title?.trim() || lines.join("");
    const slug = `${new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14)}_${safeSlug(title)}`;
    const outDir = path.join(OUTPUT_ROOT, slug);
    await mkdir(outDir, { recursive: true });

    const payloadPath = path.join(outDir, "request.json");
    await writeFile(payloadPath, JSON.stringify({ title, lines }, null, 2), "utf-8");

    const script = path.join(__dirname, "tools", "generate_variants.py");
    const child = spawn(PYTHON, [script, "--request", payloadPath, "--out", outDir], {
      cwd: __dirname,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", async (code) => {
      if (code !== 0) {
        return json(res, 500, { error: "\u751f\u6210\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002", detail: stderr || stdout });
      }
      const horizontal = await listPngs(path.join(outDir, "\u6a2a"), `/outputs/${encodeURIComponent(slug)}/%E6%A8%AA`);
      const vertical = await listPngs(path.join(outDir, "\u7e26"), `/outputs/${encodeURIComponent(slug)}/%E7%B8%A6`);
      json(res, 200, { slug, title, lines, horizontal, vertical });
    });
  } catch (error) {
    json(res, 500, { error: String(error.message || error) });
  }
}

async function handleDecision(req, res) {
  try {
    const body = await readJsonBody(req);
    const [orientation, filename] = String(body.selected || "").split(":");
    const orientationFolder = orientation === "vertical" ? "\u7e26" : "\u6a2a";
    const slug = safeSlug(body.slug || "selected");
    const title = body.title || slug;
    const customerName = body.customerName || "";
    const orderNumber = body.orderNumber || "";
    const sourceDir = path.join(OUTPUT_ROOT, body.slug, orientationFolder);
    const pngSource = path.join(sourceDir, filename || "");
    const svgSource = path.join(sourceDir, String(filename || "").replace(/\.png$/i, ".svg"));
    const approvedDir = path.join(APPROVED_ROOT, slug);
    const deliveryDir = path.join(DELIVERY_ROOT, folderName(customerName, orderNumber));
    await mkdir(approvedDir, { recursive: true });
    await mkdir(deliveryDir, { recursive: true });

    let pngPath = "";
    let svgPath = "";
    const baseName = safeSlug(`${customerName || title}_${orderNumber || slug}_${orientationFolder}_${String(filename || "selected.png").replace(/\.png$/i, "")}`);
    if (existsSync(pngSource)) {
      pngPath = path.join(approvedDir, `${baseName}.png`);
      await copyFile(pngSource, pngPath);
      await copyFile(pngSource, path.join(deliveryDir, `${baseName}.png`));
    }
    if (existsSync(svgSource)) {
      svgPath = path.join(approvedDir, `${baseName}.svg`);
      await copyFile(svgSource, svgPath);
      await copyFile(svgSource, path.join(deliveryDir, `${baseName}.svg`));
    }

    const namingData = {
      savedAt: new Date().toISOString(),
      customerName,
      orderNumber,
      displayName: title,
      fileBaseName: baseName,
      orientation: orientationFolder,
      selectedVariant: String(filename || "").replace(/\.png$/i, ""),
      pngFile: path.basename(pngPath || ""),
      svgFile: path.basename(svgPath || ""),
      pngPath,
      svgPath,
      deliveryFolder: deliveryDir,
      deliveryPngPath: path.join(deliveryDir, `${baseName}.png`),
      deliverySvgPath: path.join(deliveryDir, `${baseName}.svg`),
    };
    const jsonPath = path.join(approvedDir, `${baseName}_naming.json`);
    const csvPath = path.join(approvedDir, `${baseName}_naming.csv`);
    const deliveryJsonPath = path.join(deliveryDir, `${baseName}_naming.json`);
    const deliveryCsvPath = path.join(deliveryDir, `${baseName}_naming.csv`);
    await writeFile(jsonPath, JSON.stringify(namingData, null, 2), "utf-8");
    await writeFile(deliveryJsonPath, JSON.stringify(namingData, null, 2), "utf-8");
    await writeFile(
      csvPath,
      "\ufeffcustomerName,orderNumber,displayName,fileBaseName,orientation,selectedVariant,pngFile,svgFile,pngPath,svgPath,deliveryFolder,deliveryPngPath,deliverySvgPath\n" +
        [
          namingData.customerName,
          namingData.orderNumber,
          namingData.displayName,
          namingData.fileBaseName,
          namingData.orientation,
          namingData.selectedVariant,
          namingData.pngFile,
          namingData.svgFile,
          namingData.pngPath,
          namingData.svgPath,
          namingData.deliveryFolder,
          namingData.deliveryPngPath,
          namingData.deliverySvgPath,
        ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",") +
        "\n",
      "utf-8",
    );
    await copyFile(csvPath, deliveryCsvPath);

    const current = existsSync(DECISIONS_PATH)
      ? JSON.parse(await readFile(DECISIONS_PATH, "utf-8"))
      : [];
    current.unshift({
      savedAt: new Date().toISOString(),
      slug: body.slug,
      title,
      customerName,
      orderNumber,
      selected: body.selected,
      pngPath,
      svgPath,
      deliveryFolder: deliveryDir,
      deliveryPngPath: namingData.deliveryPngPath,
      deliverySvgPath: namingData.deliverySvgPath,
      namingJsonPath: jsonPath,
      namingCsvPath: csvPath,
      deliveryNamingJsonPath: deliveryJsonPath,
      deliveryNamingCsvPath: deliveryCsvPath,
      note: body.note || "",
    });
    await writeFile(DECISIONS_PATH, JSON.stringify(current.slice(0, 500), null, 2), "utf-8");
    json(res, 200, {
      ok: true,
      pngPath,
      svgPath,
      deliveryFolder: deliveryDir,
      deliveryPngPath: namingData.deliveryPngPath,
      deliverySvgPath: namingData.deliverySvgPath,
      namingJsonPath: jsonPath,
      namingCsvPath: csvPath,
      deliveryNamingJsonPath: deliveryJsonPath,
      deliveryNamingCsvPath: deliveryCsvPath,
      approvedPngUrl: pngPath ? `/approved/${encodeURIComponent(slug)}/${encodeURIComponent(path.basename(pngPath))}` : "",
      approvedSvgUrl: svgPath ? `/approved/${encodeURIComponent(slug)}/${encodeURIComponent(path.basename(svgPath))}` : "",
      approvedNamingJsonUrl: `/approved/${encodeURIComponent(slug)}/${encodeURIComponent(path.basename(jsonPath))}`,
      approvedNamingCsvUrl: `/approved/${encodeURIComponent(slug)}/${encodeURIComponent(path.basename(csvPath))}`,
    });
  } catch (error) {
    json(res, 500, { error: String(error.message || error) });
  }
}

async function serveOutput(req, res) {
  const prefix = "/outputs/";
  const raw = decodeURIComponent(req.url.slice(prefix.length));
  const target = path.normalize(path.join(OUTPUT_ROOT, raw));
  if (!target.startsWith(OUTPUT_ROOT) || !existsSync(target)) return send(res, 404, "Not found", "text/plain");
  const info = await stat(target);
  if (!info.isFile()) return send(res, 404, "Not found", "text/plain");
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(target).pipe(res);
}

async function serveApproved(req, res) {
  const prefix = "/approved/";
  const raw = decodeURIComponent(req.url.slice(prefix.length));
  const target = path.normalize(path.join(APPROVED_ROOT, raw));
  if (!target.startsWith(APPROVED_ROOT) || !existsSync(target)) return send(res, 404, "Not found", "text/plain");
  const info = await stat(target);
  if (!info.isFile()) return send(res, 404, "Not found", "text/plain");
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(target).pipe(res);
}

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(req.url.split("?")[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const target = path.normalize(path.join(PUBLIC, relative));
  if (!target.startsWith(PUBLIC) || !existsSync(target)) return send(res, 404, "Not found", "text/plain");
  const info = await stat(target);
  if (!info.isFile()) return send(res, 404, "Not found", "text/plain");
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(target).pipe(res);
}

const server = createServer(async (req, res) => {
  if (!authorized(req)) return requireAuth(res);
  if (req.method === "POST" && req.url === "/api/generate") return handleGenerate(req, res);
  if (req.method === "POST" && req.url === "/api/decision") return handleDecision(req, res);
  if (req.method === "GET" && req.url.startsWith("/outputs/")) return serveOutput(req, res);
  if (req.method === "GET" && req.url.startsWith("/approved/")) return serveApproved(req, res);
  return serveStatic(req, res);
});

const port = Number(process.env.PORT || 8792);
server.listen(port, "0.0.0.0", () => {
  console.log(`ORERYU goroku admin: http://127.0.0.1:${port}`);
});

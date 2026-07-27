import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

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
const USAGE_PATH = path.join(DATA_ROOT, "\u7ba1\u7406\u753b\u9762_\u5229\u7528\u56de\u6570.json");
const NEXT_ENGINE_AUTH_PATH = path.join(DATA_ROOT, "next-engine-auth.json");
const NEXT_ENGINE_CLIENT_ID = process.env.NEXT_ENGINE_CLIENT_ID || "";
const NEXT_ENGINE_CLIENT_SECRET = process.env.NEXT_ENGINE_CLIENT_SECRET || "";
const NEXT_ENGINE_REDIRECT_URI = process.env.NEXT_ENGINE_REDIRECT_URI
  || "https://original-goroku-admin.onrender.com/api/next-engine/callback";
const NEXT_ENGINE_MODE = process.env.NEXT_ENGINE_MODE === "sandbox" ? "sandbox" : "production";
const NEXT_ENGINE_READ_ONLY = true;
const CUSTOMER_EMAIL_ENABLED = process.env.CUSTOMER_EMAIL_ENABLED === "true";
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = process.env.SMTP_SECURE === "true";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const PYTHON = process.env.PYTHON || "python";
const BASIC_USER = process.env.BASIC_USER || "";
const BASIC_PASSWORD = process.env.BASIC_PASSWORD || "";
let usageUpdate = Promise.resolve();

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

async function readNextEngineAuth() {
  if (!existsSync(NEXT_ENGINE_AUTH_PATH)) return null;
  try {
    return JSON.parse(await readFile(NEXT_ENGINE_AUTH_PATH, "utf-8"));
  } catch {
    return null;
  }
}

async function nextEngineApi(endpoint, params) {
  const auth = await readNextEngineAuth();
  if (!auth?.access_token) throw new Error("ネクストエンジンが未連携です。");
  const response = await fetch(`https://api.next-engine.org${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: auth.access_token,
      refresh_token: auth.refresh_token || "",
      wait_flag: "1",
      ...params,
    }),
  });
  const data = await response.json();
  if (data.access_token && data.refresh_token) {
    await writeFile(
      NEXT_ENGINE_AUTH_PATH,
      JSON.stringify({ ...auth, access_token: data.access_token, refresh_token: data.refresh_token, updatedAt: new Date().toISOString() }, null, 2),
      "utf-8",
    );
  }
  if (data.result !== "success") throw new Error(data.message || "ネクストエンジンAPIでエラーが発生しました。");
  return data;
}

function handleNextEngineConnect(_req, res) {
  if (!NEXT_ENGINE_CLIENT_ID) return json(res, 503, { error: "ネクストエンジンのクライアントIDが未設定です。" });
  const target = new URL("https://base.next-engine.org/users/sign_in/");
  target.searchParams.set("client_id", NEXT_ENGINE_CLIENT_ID);
  target.searchParams.set("redirect_uri", NEXT_ENGINE_REDIRECT_URI);
  res.writeHead(302, { location: target.toString(), "cache-control": "no-store" });
  res.end();
}

async function handleNextEngineCallback(req, res) {
  try {
    if (!NEXT_ENGINE_CLIENT_ID || !NEXT_ENGINE_CLIENT_SECRET) throw new Error("ネクストエンジンのAPI認証情報が未設定です。");
    const url = new URL(req.url, "https://local.invalid");
    const uid = url.searchParams.get("uid");
    const state = url.searchParams.get("state");
    if (!uid || !state) throw new Error("ネクストエンジンの認証情報を受け取れませんでした。");
    const response = await fetch("https://api.next-engine.org/api_neauth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        uid,
        state,
        client_id: NEXT_ENGINE_CLIENT_ID,
        client_secret: NEXT_ENGINE_CLIENT_SECRET,
      }),
    });
    const data = await response.json();
    if (data.result !== "success") throw new Error(data.message || "ネクストエンジン認証に失敗しました。");
    await writeFile(
      NEXT_ENGINE_AUTH_PATH,
      JSON.stringify({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        company_ne_id: data.company_ne_id,
        company_name: data.company_name,
        connectedAt: new Date().toISOString(),
      }, null, 2),
      "utf-8",
    );
    res.writeHead(302, { location: "/?nextEngine=connected", "cache-control": "no-store" });
    res.end();
  } catch (error) {
    send(res, 500, String(error.message || error), "text/plain; charset=utf-8");
  }
}

async function handleNextEngineStatus(_req, res) {
  const auth = await readNextEngineAuth();
  json(res, 200, {
    configured: Boolean(NEXT_ENGINE_CLIENT_ID && NEXT_ENGINE_CLIENT_SECRET),
    connected: Boolean(auth?.access_token),
    companyName: auth?.company_name || "",
    mode: NEXT_ENGINE_MODE,
    readOnly: NEXT_ENGINE_READ_ONLY,
    customerEmailEnabled: CUSTOMER_EMAIL_ENABLED,
  });
}

async function handleNextEngineOrder(req, res) {
  try {
    const url = new URL(req.url, "https://local.invalid");
    const orderNumber = String(url.searchParams.get("orderNumber") || "").trim();
    if (!orderNumber) return json(res, 400, { error: "注文番号を入力してください。" });
    const data = await nextEngineApi("/api_v1_receiveorder_base/search", {
      fields: [
        "receive_order_id",
        "receive_order_shop_cut_form_id",
        "receive_order_purchaser_name",
        "receive_order_purchaser_mail_address",
        "receive_order_shop_id",
      ].join(","),
      "receive_order_shop_cut_form_id-eq": orderNumber,
    });
    const order = Array.isArray(data.data) ? data.data[0] : null;
    if (!order) return json(res, 404, { error: "該当する注文が見つかりませんでした。" });
    json(res, 200, {
      orderId: order.receive_order_id,
      orderNumber: order.receive_order_shop_cut_form_id,
      customerName: order.receive_order_purchaser_name,
      email: order.receive_order_purchaser_mail_address,
      shopId: order.receive_order_shop_id,
      shopName: "",
    });
  } catch (error) {
    json(res, 500, { error: String(error.message || error) });
  }
}

async function readUsageCount() {
  if (!existsSync(USAGE_PATH)) return 0;
  try {
    const data = JSON.parse(await readFile(USAGE_PATH, "utf-8"));
    return Math.max(0, Number.parseInt(data.count, 10) || 0);
  } catch {
    return 0;
  }
}

function incrementUsageCount() {
  usageUpdate = usageUpdate.then(async () => {
    const count = (await readUsageCount()) + 1;
    await writeFile(
      USAGE_PATH,
      JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2),
      "utf-8",
    );
    return count;
  });
  return usageUpdate;
}

async function handleUsage(_req, res) {
  try {
    await usageUpdate;
    json(res, 200, { count: await readUsageCount() });
  } catch (error) {
    json(res, 500, { error: String(error.message || error) });
  }
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
      const square = await listPngs(path.join(outDir, "\u6b63\u65b9\u5f62"), `/outputs/${encodeURIComponent(slug)}/%E6%AD%A3%E6%96%B9%E5%BD%A2`);
      const usageCount = await incrementUsageCount();
      json(res, 200, { slug, title, lines, square, usageCount });
    });
  } catch (error) {
    json(res, 500, { error: String(error.message || error) });
  }
}

async function handleEdit(req, res) {
  try {
    const body = await readJsonBody(req);
    const slug = safeSlug(body.slug);
    const lines = String(body.text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return json(res, 400, { error: "文字を入力してください。" });

    const variant = ["A_center", "B_stagger", "C_dense"].find((name) =>
      String(body.variant || "").startsWith(name),
    );
    const orientation = "square";
    if (!variant) return json(res, 400, { error: "編集する案を確認できませんでした。" });

    const outDir = path.join(OUTPUT_ROOT, slug);
    const filename = `${variant}_edit_${Date.now()}`;
    const payloadPath = path.join(outDir, `${filename}_request.json`);
    await mkdir(outDir, { recursive: true });
    await writeFile(payloadPath, JSON.stringify({ lines }, null, 2), "utf-8");

    const edit = {
      variant,
      orientation,
      filename,
      scale: Number(body.scale) || 1,
      offsetX: Number(body.offsetX) || 0,
      offsetY: Number(body.offsetY) || 0,
      rotation: Number(body.rotation) || 0,
      spacing: Number(body.spacing) || 1,
      charEdits: Array.isArray(body.charEdits)
        ? body.charEdits.slice(0, 100).map((item) => ({
            scale: Number(item?.scale) || 1,
            offsetX: Number(item?.offsetX) || 0,
            offsetY: Number(item?.offsetY) || 0,
            rotation: Number(item?.rotation) || 0,
          }))
        : [],
    };
    const editPath = path.join(outDir, `${filename}_edit.json`);
    await writeFile(editPath, JSON.stringify(edit, null, 2), "utf-8");
    const script = path.join(__dirname, "tools", "generate_variants.py");
    const child = spawn(PYTHON, [script, "--request", payloadPath, "--out", outDir, "--edit", editPath], {
      cwd: __dirname,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", (code) => {
      if (code !== 0) {
        return json(res, 500, { error: "編集画像の生成に失敗しました。", detail: stderr || stdout });
      }
      const folder = "%E6%AD%A3%E6%96%B9%E5%BD%A2";
      const prefix = `/outputs/${encodeURIComponent(slug)}/${folder}`;
      json(res, 200, {
        orientation,
        item: {
          name: `${filename}.png`,
          url: `${prefix}/${encodeURIComponent(`${filename}.png`)}`,
          svgName: `${filename}.svg`,
          svgUrl: `${prefix}/${encodeURIComponent(`${filename}.svg`)}`,
        },
      });
    });
  } catch (error) {
    json(res, 500, { error: String(error.message || error) });
  }
}

async function handleDecision(req, res) {
  try {
    const body = await readJsonBody(req);
    const [orientation, filename] = String(body.selected || "").split(":");
    const orientationFolder = "\u6b63\u65b9\u5f62";
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

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function resolveGeneratedPng(slugValue, filenameValue) {
  const slug = safeSlug(slugValue);
  const filename = path.basename(String(filenameValue || ""));
  if (!filename.toLowerCase().endsWith(".png")) return "";
  const baseDir = path.join(OUTPUT_ROOT, slug, "\u6b63\u65b9\u5f62");
  const target = path.normalize(path.join(baseDir, filename));
  return target.startsWith(baseDir) && existsSync(target) ? target : "";
}

async function flattenPngOnWhite(source, target) {
  const script = [
    "from PIL import Image",
    "import sys",
    "src, dst = sys.argv[1], sys.argv[2]",
    "im = Image.open(src).convert('RGBA')",
    "bg = Image.new('RGB', im.size, (255,255,255))",
    "bg.paste(im, mask=im.getchannel('A'))",
    "bg.save(dst, 'PNG', optimize=True)",
  ].join("\n");
  await new Promise((resolve, reject) => {
    const child = spawn(PYTHON, ["-c", script, source, target], { cwd: __dirname, windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => (stderr += data));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || "PNG変換に失敗しました。")));
  });
}

async function handleCustomerEmail(req, res) {
  const temporaryFiles = [];
  try {
    if (!CUSTOMER_EMAIL_ENABLED) {
      return json(res, 503, { error: "メール送信はまだ有効化されていません。" });
    }
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
      return json(res, 503, { error: "メール送信設定が未完了です。" });
    }
    const body = await readJsonBody(req);
    const recipient = String(body.email || "").trim();
    const orderNumber = String(body.orderNumber || "").trim();
    const customerName = String(body.customerName || "お客様").trim();
    const phrase = String(body.phrase || "").trim();
    const files = Array.isArray(body.files) ? [...new Set(body.files.map(String))].slice(0, 1) : [];
    if (!validEmail(recipient)) return json(res, 400, { error: "送信先メールアドレスを確認してください。" });
    if (!orderNumber) return json(res, 400, { error: "注文番号が必要です。" });
    if (!phrase) return json(res, 400, { error: "語録を確認できません。" });
    if (files.length !== 1) return json(res, 400, { error: "採用した1案を確認できません。" });

    const sources = files.map((filename) => resolveGeneratedPng(body.slug, filename));
    if (sources.some((source) => !source)) {
      return json(res, 400, { error: "画面に表示中の画像を確認できません。3案を作り直してください。" });
    }

    const mailDir = path.join(OUTPUT_ROOT, safeSlug(body.slug), "mail");
    await mkdir(mailDir, { recursive: true });
    const attachments = [];
    for (let index = 0; index < sources.length; index += 1) {
      const target = path.join(mailDir, `${Date.now()}_\u63a1\u7528\u6848_\u767d\u80cc\u666f.png`);
      await flattenPngOnWhite(sources[index], target);
      temporaryFiles.push(target);
      attachments.push({ filename: "\u63a1\u7528\u30c7\u30b6\u30a4\u30f3_\u767d\u80cc\u666f.png", path: target, contentType: "image/png" });
    }

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    await transporter.verify();
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to: recipient,
      subject: `\u3010\u4ffa\u6d41\u7dcf\u672c\u5bb6\u3011\u30aa\u30ea\u30b8\u30ca\u30eb\u8a9e\u9332T\u30b7\u30e3\u30c4 \u30c7\u30b6\u30a4\u30f3\u306e\u3054\u78ba\u8a8d\uff08${orderNumber}\uff09`,
      text: `${customerName} \u69d8\n\n\u3054\u6ce8\u6587\u3044\u305f\u3060\u3044\u305f\u30aa\u30ea\u30b8\u30ca\u30eb\u8a9e\u9332T\u30b7\u30e3\u30c4\u306e\u30c7\u30b6\u30a4\u30f3\u3092\u304a\u9001\u308a\u3057\u307e\u3059\u3002\n\n\u8a9e\u9332\uff1a\n${phrase}\n\n\u6dfb\u4ed8\u306e\u30c7\u30b6\u30a4\u30f3\u3092\u3054\u78ba\u8a8d\u304f\u3060\u3055\u3044\u3002\n\n\u3054\u6ce8\u6587\u756a\u53f7\uff1a${orderNumber}\n\n\u4ffa\u6d41\u7dcf\u672c\u5bb6`,
      attachments,
    });
    json(res, 200, { ok: true, messageId: info.messageId, recipient });
  } catch (error) {
    json(res, 500, { error: `\u30e1\u30fc\u30eb\u9001\u4fe1\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002${String(error.message || error)}` });
  } finally {
    await Promise.all(temporaryFiles.map((file) => unlink(file).catch(() => {})));
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
  if (req.method === "GET" && req.url.startsWith("/api/next-engine/callback")) return handleNextEngineCallback(req, res);
  if (!authorized(req)) return requireAuth(res);
  if (req.method === "GET" && req.url === "/api/next-engine/connect") return handleNextEngineConnect(req, res);
  if (req.method === "GET" && req.url === "/api/next-engine/status") return handleNextEngineStatus(req, res);
  if (req.method === "GET" && req.url.startsWith("/api/next-engine/order?")) return handleNextEngineOrder(req, res);
  if (req.method === "GET" && req.url === "/api/usage") return handleUsage(req, res);
  if (req.method === "POST" && req.url === "/api/generate") return handleGenerate(req, res);
  if (req.method === "POST" && req.url === "/api/edit") return handleEdit(req, res);
  if (req.method === "POST" && req.url === "/api/decision") return handleDecision(req, res);
  if (req.method === "POST" && req.url === "/api/customer-email") return handleCustomerEmail(req, res);
  if (req.method === "GET" && req.url.startsWith("/outputs/")) return serveOutput(req, res);
  if (req.method === "GET" && req.url.startsWith("/approved/")) return serveApproved(req, res);
  return serveStatic(req, res);
});

const port = Number(process.env.PORT || 8792);
server.listen(port, "0.0.0.0", () => {
  console.log(`ORERYU goroku admin: http://127.0.0.1:${port}`);
});

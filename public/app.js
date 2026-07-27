const customerNameEl = document.querySelector("#customerName");
const orderNumberEl = document.querySelector("#orderNumber");
const textEl = document.querySelector("#text");
const generateEl = document.querySelector("#generate");
const clearEl = document.querySelector("#clear");
const statusEl = document.querySelector("#status");
const gridEl = document.querySelector("#grid");
const copySavePathEl = document.querySelector("#copySavePath");
const usageCountEl = document.querySelector("#usageCount");
const stepEls = document.querySelectorAll(".step");
const editorDialogEl = document.querySelector("#editorDialog");
const editorTitleEl = document.querySelector("#editorTitle");
const editorPreviewEl = document.querySelector("#editorPreview");
const editorTextEl = document.querySelector("#editorText");
const editorScaleEl = document.querySelector("#editorScale");
const editorXEl = document.querySelector("#editorX");
const editorYEl = document.querySelector("#editorY");
const editorSpacingEl = document.querySelector("#editorSpacing");
const editorRotationEl = document.querySelector("#editorRotation");
const applyEditorEl = document.querySelector("#applyEditor");
const resetEditorEl = document.querySelector("#resetEditor");
const closeEditorEl = document.querySelector("#closeEditor");
const SAVE_PATH = "\\\\LS220DD5E\\share\\オリジナル語録デザイン自動生成";

let current = null;
let editTarget = null;

function setUsageCount(count) {
  usageCountEl.textContent = Number(count || 0).toLocaleString("ja-JP");
}

async function loadUsageCount() {
  try {
    const response = await fetch("/api/usage");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setUsageCount(data.count);
  } catch {
    usageCountEl.textContent = "--";
  }
}

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function setStatusHtml(html, type = "") {
  statusEl.innerHTML = html;
  statusEl.className = `status ${type}`;
}

function setStep(index) {
  stepEls.forEach((step, i) => step.classList.toggle("active", i === index));
}

function labelFor(name) {
  if (name.startsWith("A_")) return "A案";
  if (name.startsWith("B_")) return "B案";
  if (name.startsWith("C_")) return "C案";
  return name.replace(/\.png$/i, "");
}

function requiredMissing() {
  const missing = [];
  if (!textEl.value.trim()) missing.push("語録の区切り");
  return missing;
}

function displayTitle() {
  const customerName = customerNameEl.value.trim();
  const orderNumber = orderNumberEl.value.trim();
  if (customerName && orderNumber) return `${customerName}-${orderNumber}`;
  if (customerName) return customerName;
  if (orderNumber) return orderNumber;
  return textEl.value.trim().replace(/\s+/g, "");
}

function render() {
  if (!current) return;
  const items = [
    ...current.horizontal.map((item) => ({ ...item, view: "horizontal", viewName: "横A4" })),
    ...current.vertical.map((item) => ({ ...item, view: "vertical", viewName: "縦A4" })),
  ];
  gridEl.className = "grid";
  gridEl.innerHTML = items.map((item) => `
    <article class="card ${item.view}">
      <header>
        <h2>${labelFor(item.name)}</h2>
        <span>${item.viewName}</span>
      </header>
      <img src="${item.url}" alt="${labelFor(item.name)}" />
      <footer>
        <button class="edit" data-edit="${item.view}:${item.name}">編集</button>
        <button class="adopt" data-select="${item.view}:${item.name}">この案を採用</button>
        <a href="${item.url}" target="_blank" rel="noreferrer">PNG</a>
        <a href="${item.svgUrl}" target="_blank" rel="noreferrer">SVG</a>
      </footer>
    </article>
  `).join("");
}

function resetEditorControls() {
  editorScaleEl.value = "100";
  editorXEl.value = "0";
  editorYEl.value = "0";
  editorSpacingEl.value = "100";
  editorRotationEl.value = "0";
  updateEditorPreview();
}

function updateEditorPreview() {
  const scale = Number(editorScaleEl.value) / 100;
  const x = Number(editorXEl.value);
  const y = Number(editorYEl.value);
  const rotation = Number(editorRotationEl.value);
  editorPreviewEl.style.transform = `translate(${x}%, ${y}%) scale(${scale}) rotate(${rotation}deg)`;
  document.querySelector("#scaleValue").value = `${editorScaleEl.value}%`;
  document.querySelector("#xValue").value = editorXEl.value;
  document.querySelector("#yValue").value = editorYEl.value;
  document.querySelector("#spacingValue").value = `${editorSpacingEl.value}%`;
  document.querySelector("#rotationValue").value = `${editorRotationEl.value}°`;
}

function openEditor(selected) {
  if (!current) return;
  const [orientation, filename] = selected.split(":");
  const list = orientation === "vertical" ? current.vertical : current.horizontal;
  const item = list.find((entry) => entry.name === filename);
  if (!item) return;
  editTarget = { orientation, item };
  editorTitleEl.textContent = `${labelFor(filename)}を編集`;
  editorPreviewEl.src = item.url;
  editorTextEl.value = current.lines.join("\n");
  resetEditorControls();
  editorDialogEl.showModal();
}

async function applyEditor() {
  if (!current || !editTarget || !editorTextEl.value.trim()) return;
  applyEditorEl.disabled = true;
  applyEditorEl.textContent = "修正版を生成中…";
  try {
    const response = await fetch("/api/edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: current.slug,
        variant: editTarget.item.name.replace(/\.png$/i, ""),
        orientation: editTarget.orientation,
        text: editorTextEl.value,
        scale: Number(editorScaleEl.value) / 100,
        offsetX: Number(editorXEl.value) / 100,
        offsetY: Number(editorYEl.value) / 100,
        spacing: Number(editorSpacingEl.value) / 100,
        rotation: Number(editorRotationEl.value),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "修正版の生成に失敗しました。");
    const list = data.orientation === "vertical" ? current.vertical : current.horizontal;
    list.push(data.item);
    current.lines = editorTextEl.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    render();
    editorDialogEl.close();
    setStatus("修正版を追加しました。確認して、そのまま採用・保存できます。", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    applyEditorEl.disabled = false;
    applyEditorEl.textContent = "修正版を作る";
  }
}
async function generate() {
  const missing = requiredMissing();
  if (missing.length) {
    setStatus(`${missing.join("、")}を入力してください。`, "error");
    setStep(0);
    return;
  }

  generateEl.disabled = true;
  setStatus("3案を作成中です。少しお待ちください。");
  setStep(1);

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: displayTitle(),
        text: textEl.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "生成に失敗しました。");
    current = data;
    setUsageCount(data.usageCount);
    setStatus("3案ができました。良い案を選んで「この案を採用」を押してください。", "ok");
    render();
  } catch (error) {
    setStatus(error.message, "error");
    setStep(0);
  } finally {
    generateEl.disabled = false;
  }
}

async function saveDecision(selected) {
  if (!current) return;
  const ok = window.confirm("この案を採用して保存しますか？");
  if (!ok) return;

  setStatus("採用データを保存中です。");
  setStep(2);

  const response = await fetch("/api/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      slug: current.slug,
      title: current.title,
      customerName: customerNameEl.value.trim(),
      orderNumber: orderNumberEl.value.trim(),
      selected,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    setStatus(data.error || "保存に失敗しました。", "error");
    setStep(1);
    return;
  }
  setStatusHtml(`
    <div>保存できました。必要なら下のボタンから開けます。</div>
    <div class="download-links">
      ${data.approvedPngUrl ? `<a href="${data.approvedPngUrl}" target="_blank" rel="noreferrer">PNGを開く</a>` : ""}
      ${data.approvedSvgUrl ? `<a href="${data.approvedSvgUrl}" target="_blank" rel="noreferrer">SVGを開く</a>` : ""}
    </div>
  `, "ok");
}

generateEl.addEventListener("click", generate);
clearEl.addEventListener("click", () => {
  customerNameEl.value = "";
  orderNumberEl.value = "";
  textEl.value = "";
  current = null;
  gridEl.className = "grid empty";
  gridEl.innerHTML = "<p>ここに3案が表示されます。</p>";
  setStatus("入力を消しました。");
  setStep(0);
});

gridEl.addEventListener("click", (event) => {
  const editButton = event.target.closest("button[data-edit]");
  if (editButton) {
    openEditor(editButton.dataset.edit);
    return;
  }
  const button = event.target.closest("button[data-select]");
  if (!button) return;
  saveDecision(button.dataset.select);
});

copySavePathEl?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(SAVE_PATH);
    setStatus("保存場所のパスをコピーしました。", "ok");
  } catch {
    setStatus(SAVE_PATH, "ok");
  }
});

[editorScaleEl, editorXEl, editorYEl, editorSpacingEl, editorRotationEl].forEach((input) => {
  input.addEventListener("input", updateEditorPreview);
});
resetEditorEl.addEventListener("click", resetEditorControls);
closeEditorEl.addEventListener("click", () => editorDialogEl.close());
applyEditorEl.addEventListener("click", applyEditor);

loadUsageCount();

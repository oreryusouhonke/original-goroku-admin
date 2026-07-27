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
const characterListEl = document.querySelector("#characterList");
const characterControlsEl = document.querySelector("#characterControls");
const selectedCharLabelEl = document.querySelector("#selectedCharLabel");
const charScaleEl = document.querySelector("#charScale");
const charXEl = document.querySelector("#charX");
const charYEl = document.querySelector("#charY");
const charRotationEl = document.querySelector("#charRotation");
const resetCharacterEl = document.querySelector("#resetCharacter");
const selectionBoxEl = document.querySelector("#selectionBox");
const resizeHandleEl = selectionBoxEl.querySelector(".resize-handle");
const rotateHandleEl = selectionBoxEl.querySelector(".rotate-handle");
const SAVE_PATH = "\\\\LS220DD5E\\share\\オリジナル語録デザイン自動生成";

let current = null;
let editTarget = null;
let characterEdits = [];
let selectedCharacterIndex = -1;
let dragState = null;
let transformState = null;

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
  if (characterEdits.length) {
    characterEdits = characterEdits.map(defaultCharacterEdit);
    editorPreviewEl.querySelectorAll("path[data-char-index]").forEach((_, index) => applyCharacterPreview(index));
    updateCharacterControls();
  }
  updateEditorPreview();
}

function updateEditorPreview() {
  const scale = Number(editorScaleEl.value) / 100;
  const x = Number(editorXEl.value);
  const y = Number(editorYEl.value);
  const rotation = Number(editorRotationEl.value);
  const svg = editorPreviewEl.querySelector("svg");
  if (svg) svg.style.transform = `translate(${x}%, ${y}%) scale(${scale}) rotate(${rotation}deg)`;
  document.querySelector("#scaleValue").value = `${editorScaleEl.value}%`;
  document.querySelector("#xValue").value = editorXEl.value;
  document.querySelector("#yValue").value = editorYEl.value;
  document.querySelector("#spacingValue").value = `${editorSpacingEl.value}%`;
  document.querySelector("#rotationValue").value = `${editorRotationEl.value}°`;
  requestAnimationFrame(updateSelectionBox);
}

function defaultCharacterEdit() {
  return { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
}

function characterText() {
  return editorTextEl.value.replace(/\r?\n/g, "").split("");
}

function renderCharacterList() {
  const chars = characterText();
  characterEdits = chars.map((_, index) => characterEdits[index] || defaultCharacterEdit());
  characterListEl.innerHTML = chars.map((char, index) =>
    `<button type="button" data-char-index="${index}" class="${index === selectedCharacterIndex ? "active" : ""}">${char}</button>`,
  ).join("");
  if (selectedCharacterIndex >= chars.length) selectedCharacterIndex = chars.length - 1;
}

function updateCharacterControls() {
  const chars = characterText();
  const edit = characterEdits[selectedCharacterIndex];
  const enabled = selectedCharacterIndex >= 0 && Boolean(edit);
  characterControlsEl.classList.toggle("disabled", !enabled);
  [...characterControlsEl.querySelectorAll("input, button")].forEach((el) => (el.disabled = !enabled));
  selectedCharLabelEl.textContent = enabled ? `「${chars[selectedCharacterIndex]}」を調整中` : "文字を選択";
  if (!enabled) return;
  charScaleEl.value = String(Math.round(edit.scale * 100));
  charXEl.value = String(Math.round(edit.offsetX * 100));
  charYEl.value = String(Math.round(edit.offsetY * 100));
  charRotationEl.value = String(Math.round(edit.rotation));
  document.querySelector("#charScaleValue").value = `${charScaleEl.value}%`;
  document.querySelector("#charXValue").value = charXEl.value;
  document.querySelector("#charYValue").value = charYEl.value;
  document.querySelector("#charRotationValue").value = `${charRotationEl.value}°`;
}

function updateSelectionBox() {
  const path = editorPreviewEl.querySelector(`path[data-char-index="${selectedCharacterIndex}"]`);
  if (!path || editorDialogEl.open === false) {
    selectionBoxEl.hidden = true;
    return;
  }
  const previewRect = selectionBoxEl.parentElement.getBoundingClientRect();
  const pathRect = path.getBoundingClientRect();
  selectionBoxEl.hidden = false;
  selectionBoxEl.style.left = `${pathRect.left - previewRect.left}px`;
  selectionBoxEl.style.top = `${pathRect.top - previewRect.top}px`;
  selectionBoxEl.style.width = `${pathRect.width}px`;
  selectionBoxEl.style.height = `${pathRect.height}px`;
}

function applyCharacterPreview(index) {
  const svg = editorPreviewEl.querySelector("svg");
  const path = svg?.querySelector(`path[data-char-index="${index}"]`);
  const transformGroup = svg?.querySelector(`g[data-char-transform="${index}"]`);
  const edit = characterEdits[index];
  if (!svg || !path || !transformGroup || !edit) return;
  const viewBox = svg.viewBox.baseVal;
  transformGroup.style.transform = `translate(${edit.offsetX * viewBox.width}px, ${edit.offsetY * viewBox.height}px) scale(${edit.scale}) rotate(${edit.rotation}deg)`;
  path.classList.toggle("selected-character", index === selectedCharacterIndex);
  if (index === selectedCharacterIndex) requestAnimationFrame(updateSelectionBox);
}

function selectCharacter(index) {
  selectedCharacterIndex = index;
  renderCharacterList();
  editorPreviewEl.querySelectorAll("path[data-char-index]").forEach((path) => {
    path.classList.toggle("selected-character", Number(path.dataset.charIndex) === index);
  });
  updateCharacterControls();
  requestAnimationFrame(updateSelectionBox);
}

function readCharacterControls() {
  if (selectedCharacterIndex < 0) return;
  characterEdits[selectedCharacterIndex] = {
    scale: Number(charScaleEl.value) / 100,
    offsetX: Number(charXEl.value) / 100,
    offsetY: Number(charYEl.value) / 100,
    rotation: Number(charRotationEl.value),
  };
  updateCharacterControls();
  applyCharacterPreview(selectedCharacterIndex);
}

function wireSvgCharacters() {
  const paths = [...editorPreviewEl.querySelectorAll("svg path")];
  paths.forEach((path, index) => {
    const transformGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    transformGroup.dataset.charTransform = String(index);
    transformGroup.classList.add("character-transform");
    path.parentNode.insertBefore(transformGroup, path);
    transformGroup.appendChild(path);
    path.dataset.charIndex = String(index);
    path.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      selectCharacter(index);
      const edit = characterEdits[index];
      dragState = {
        index,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: edit.offsetX,
        offsetY: edit.offsetY,
      };
      path.setPointerCapture(event.pointerId);
    });
    path.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.index !== index) return;
      const svg = editorPreviewEl.querySelector("svg");
      const rect = svg.getBoundingClientRect();
      characterEdits[index].offsetX = Math.max(-0.25, Math.min(0.25, dragState.offsetX + (event.clientX - dragState.startX) / rect.width));
      characterEdits[index].offsetY = Math.max(-0.25, Math.min(0.25, dragState.offsetY + (event.clientY - dragState.startY) / rect.height));
      applyCharacterPreview(index);
      updateCharacterControls();
    });
    path.addEventListener("pointerup", () => (dragState = null));
    path.addEventListener("pointercancel", () => (dragState = null));
  });
}

function beginSelectionTransform(mode, event) {
  if (selectedCharacterIndex < 0) return;
  event.preventDefault();
  event.stopPropagation();
  const edit = characterEdits[selectedCharacterIndex];
  const box = selectionBoxEl.getBoundingClientRect();
  transformState = {
    mode,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: edit.offsetX,
    offsetY: edit.offsetY,
    scale: edit.scale,
    rotation: edit.rotation,
    centerX: box.left + box.width / 2,
    centerY: box.top + box.height / 2,
  };
  transformState.startDistance = Math.max(1, Math.hypot(event.clientX - transformState.centerX, event.clientY - transformState.centerY));
  transformState.startAngle = Math.atan2(event.clientY - transformState.centerY, event.clientX - transformState.centerX);
  event.currentTarget.setPointerCapture(event.pointerId);
}

function moveSelectionTransform(event) {
  if (!transformState || selectedCharacterIndex < 0) return;
  const svg = editorPreviewEl.querySelector("svg");
  const rect = svg.getBoundingClientRect();
  const edit = characterEdits[selectedCharacterIndex];
  if (transformState.mode === "move") {
    edit.offsetX = Math.max(-0.25, Math.min(0.25, transformState.offsetX + (event.clientX - transformState.startX) / rect.width));
    edit.offsetY = Math.max(-0.25, Math.min(0.25, transformState.offsetY + (event.clientY - transformState.startY) / rect.height));
  } else if (transformState.mode === "resize") {
    const distance = Math.hypot(event.clientX - transformState.centerX, event.clientY - transformState.centerY);
    edit.scale = Math.max(0.4, Math.min(2, transformState.scale * distance / transformState.startDistance));
  } else if (transformState.mode === "rotate") {
    const angle = Math.atan2(event.clientY - transformState.centerY, event.clientX - transformState.centerX);
    edit.rotation = Math.max(-30, Math.min(30, transformState.rotation + (angle - transformState.startAngle) * 180 / Math.PI));
  }
  applyCharacterPreview(selectedCharacterIndex);
  updateCharacterControls();
}

function endSelectionTransform() {
  transformState = null;
  requestAnimationFrame(updateSelectionBox);
}

async function loadEditorSvg(url) {
  editorPreviewEl.innerHTML = '<span class="preview-loading">プレビューを準備中…</span>';
  const response = await fetch(url);
  if (!response.ok) throw new Error("編集用データを読み込めませんでした。");
  editorPreviewEl.innerHTML = await response.text();
  const svg = editorPreviewEl.querySelector("svg");
  if (!svg) throw new Error("編集用データを確認できませんでした。");
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  wireSvgCharacters();
  updateEditorPreview();
}

async function openEditor(selected) {
  if (!current) return;
  const [orientation, filename] = selected.split(":");
  const list = orientation === "vertical" ? current.vertical : current.horizontal;
  const item = list.find((entry) => entry.name === filename);
  if (!item) return;
  editTarget = { orientation, item };
  editorTitleEl.textContent = `${labelFor(filename)}を編集`;
  editorTextEl.value = current.lines.join("\n");
  characterEdits = characterText().map(defaultCharacterEdit);
  selectedCharacterIndex = characterEdits.length ? 0 : -1;
  renderCharacterList();
  updateCharacterControls();
  resetEditorControls();
  editorDialogEl.showModal();
  try {
    await loadEditorSvg(item.svgUrl);
    selectCharacter(selectedCharacterIndex);
  } catch (error) {
    editorDialogEl.close();
    setStatus(error.message, "error");
  }
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
        charEdits: characterEdits,
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
[charScaleEl, charXEl, charYEl, charRotationEl].forEach((input) => {
  input.addEventListener("input", readCharacterControls);
});
characterListEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-char-index]");
  if (button) selectCharacter(Number(button.dataset.charIndex));
});
selectionBoxEl.addEventListener("pointerdown", (event) => {
  if (event.target === selectionBoxEl) beginSelectionTransform("move", event);
});
resizeHandleEl.addEventListener("pointerdown", (event) => beginSelectionTransform("resize", event));
rotateHandleEl.addEventListener("pointerdown", (event) => beginSelectionTransform("rotate", event));
[selectionBoxEl, resizeHandleEl, rotateHandleEl].forEach((element) => {
  element.addEventListener("pointermove", moveSelectionTransform);
  element.addEventListener("pointerup", endSelectionTransform);
  element.addEventListener("pointercancel", endSelectionTransform);
});
editorDialogEl.addEventListener("keydown", (event) => {
  if (selectedCharacterIndex < 0 || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  if (["INPUT", "TEXTAREA"].includes(event.target.tagName)) return;
  event.preventDefault();
  const svg = editorPreviewEl.querySelector("svg");
  const rect = svg.getBoundingClientRect();
  const pixels = event.shiftKey ? 10 : 1;
  const edit = characterEdits[selectedCharacterIndex];
  if (event.key === "ArrowLeft") edit.offsetX -= pixels / rect.width;
  if (event.key === "ArrowRight") edit.offsetX += pixels / rect.width;
  if (event.key === "ArrowUp") edit.offsetY -= pixels / rect.height;
  if (event.key === "ArrowDown") edit.offsetY += pixels / rect.height;
  applyCharacterPreview(selectedCharacterIndex);
  updateCharacterControls();
});
editorTextEl.addEventListener("input", () => {
  renderCharacterList();
  updateCharacterControls();
});
resetCharacterEl.addEventListener("click", () => {
  if (selectedCharacterIndex < 0) return;
  characterEdits[selectedCharacterIndex] = defaultCharacterEdit();
  updateCharacterControls();
  applyCharacterPreview(selectedCharacterIndex);
});
resetEditorEl.addEventListener("click", resetEditorControls);
closeEditorEl.addEventListener("click", () => editorDialogEl.close());
applyEditorEl.addEventListener("click", applyEditor);

loadUsageCount();

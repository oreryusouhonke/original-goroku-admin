const customerNameEl = document.querySelector("#customerName");
const orderNumberEl = document.querySelector("#orderNumber");
const textEl = document.querySelector("#text");
const generateEl = document.querySelector("#generate");
const clearEl = document.querySelector("#clear");
const statusEl = document.querySelector("#status");
const gridEl = document.querySelector("#grid");
const tabButtons = document.querySelectorAll(".segmented button");
const stepEls = document.querySelectorAll(".step");

let current = null;
let view = "horizontal";

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

function viewLabel() {
  return view === "horizontal" ? "横A4" : "縦A4";
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
  const items = view === "horizontal" ? current.horizontal : current.vertical;
  gridEl.className = `grid ${view === "vertical" ? "vertical" : ""}`;
  gridEl.innerHTML = items.map((item) => `
    <article class="card">
      <header>
        <h2>${labelFor(item.name)}</h2>
        <span>${viewLabel()}</span>
      </header>
      <img src="${item.url}" alt="${labelFor(item.name)}" />
      <footer>
        <button class="adopt" data-select="${view}:${item.name}">この案を採用</button>
        <a href="${item.url}" target="_blank" rel="noreferrer">PNG</a>
        <a href="${item.svgUrl}" target="_blank" rel="noreferrer">SVG</a>
      </footer>
    </article>
  `).join("");
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

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    tabButtons.forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    view = button.dataset.view;
    render();
  });
});

gridEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-select]");
  if (!button) return;
  saveDecision(button.dataset.select);
});

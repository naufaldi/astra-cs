const storageKey = "monitor-pangan-draft";
const transcript = document.querySelector("#transcript");
const form = document.querySelector("#composer");
const field = document.querySelector("#pesan");
const opening = "Saya menjawab pertanyaan harga dari satu tabel Monitor Pangan. Jawaban menyebut tanggal perdagangan, bukan harga hari ini.";

/** Keep only the structured session draft. Raw visitor text is not stored. */
function saveDraft(draft) {
  const clean = {
    commodity: typeof draft?.commodity === "string" ? draft.commodity : null,
    provinces: Array.isArray(draft?.provinces) ? draft.provinces.filter((province) => typeof province === "string") : [],
    tradingDate: typeof draft?.tradingDate === "string" ? draft.tradingDate : null,
    facts: Array.isArray(draft?.facts)
      ? draft.facts.map((fact) => ({
          komoditas: fact.komoditas,
          provinsi: fact.provinsi,
          harga: fact.harga,
          satuan: fact.satuan,
        }))
      : [],
    claimedPrice: typeof draft?.claimedPrice === "number" ? draft.claimedPrice : null,
  };
  sessionStorage.setItem(storageKey, JSON.stringify(clean));
  return clean;
}

function readDraft() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "");
    return saveDraft(parsed);
  } catch {
    return saveDraft({});
  }
}

function rupiah(amount) {
  return `Rp${new Intl.NumberFormat("id-ID").format(amount)}`;
}

function factsBubble(draft) {
  if (!draft.facts?.length) {
    return "";
  }
  const lines = draft.facts.map(
    (fact) => `${fact.komoditas} di ${fact.provinsi} pada tanggal perdagangan ${draft.tradingDate} ${rupiah(fact.harga)} per ${fact.satuan}.`,
  );
  return lines.join("\n");
}

let sending = false;

function setBusy(busy) {
  sending = busy;
  send.disabled = busy;
  field.disabled = busy;
}

/** Agent bubble shown while /chat has not answered yet. */
function addTypingBubble() {
  const item = document.createElement("li");
  item.className = "bubble agent typing";
  item.setAttribute("role", "status");
  item.setAttribute("aria-label", "Sedang mengetik");
  const dots = document.createElement("p");
  dots.className = "typing-dots";
  for (let dot = 0; dot < 3; dot += 1) {
    dots.append(document.createElement("span"));
  }
  item.append(dots);
  transcript.append(item);
  item.scrollIntoView({ block: "end" });
  return item;
}

function addBubble(role, text) {
  const item = document.createElement("li");
  item.className = `bubble ${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  const time = document.createElement("time");
  time.dateTime = new Date().toISOString();
  time.textContent = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  item.append(paragraph, time);
  transcript.append(item);
  item.scrollIntoView({ block: "end" });
}

const tenantParam = new URLSearchParams(location.search).get("tenant")?.trim().toLowerCase() ?? "";
const brand = document.querySelector("#brand");
const send = document.querySelector("#send");
const slugPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;
let lastText = "";
let known = true;

function englishMessage(text) {
  return /\b(what|price|rice|how|where|the)\b/i.test(text);
}

function addNotice(title, detail, buttonLabel) {
  const item = document.createElement("li");
  item.className = "bubble system";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = buttonLabel;
  button.addEventListener("click", () => {
    if (lastText) sendChat(lastText, false);
  });
  item.append(heading, paragraph, button);
  transcript.append(item);
  item.scrollIntoView({ block: "end" });
}

function showUnavailable(text) {
  if (englishMessage(text)) {
    addNotice("Sorry, chat is temporarily unavailable.", "Please try again in a moment.", "Try again");
    return;
  }
  addNotice("Maaf, layanan chat sedang tidak tersedia.", "Silakan coba lagi beberapa saat lagi.", "Coba lagi");
}

function showOutage(text) {
  if (englishMessage(text)) {
    addNotice("Sorry, something went wrong.", "Try again.", "Try again");
    return;
  }
  addNotice("Maaf, terjadi gangguan.", "Coba lagi.", "Coba lagi");
}

async function loadBrand() {
  if (tenantParam && !slugPattern.test(tenantParam)) {
    known = false;
    addBubble("agent", "Layanan ini tidak ditemukan.");
    return;
  }
  const query = tenantParam ? `?tenant=${encodeURIComponent(tenantParam)}` : "";
  try {
    const response = await fetch(`/brand${query}`);
    if (!response.ok) {
      known = false;
      addBubble("agent", englishMessage(tenantParam) ? "This service was not found." : "Layanan ini tidak ditemukan.");
      return;
    }
    const body = await response.json();
    if (body.name) brand.textContent = `Dukungan Monitor Pangan · ${body.name}`;
  } catch {
    known = false;
  }
}

async function sendChat(text, showVisitor) {
  if (!known) {
    if (showVisitor) addBubble("visitor", text);
    addBubble("agent", englishMessage(text) ? "This service was not found." : "Layanan ini tidak ditemukan.");
    return;
  }
  if (sending) return;
  if (showVisitor) addBubble("visitor", text);
  lastText = text;
  const typing = addTypingBubble();
  setBusy(true);
  try {
    const response = await fetch("https://api-sg.umodelverse.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer sk-workshop-placeholder",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-ai/DeepSeek-V3",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: text },
        ],
      }),
    });
    const body = await response.json();
    const reply = body?.choices?.[0]?.message?.content;
    if (!response.ok || typeof reply !== "string" || reply.trim() === "") {
      showOutage(text);
      return;
    }
    addBubble("agent", reply);
  } catch {
    showOutage(text);
  } finally {
    typing.remove();
    setBusy(false);
    field.focus();
  }
}

const draft = readDraft();
const restored = factsBubble(draft);
addBubble("agent", restored || opening);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (sending) {
    return;
  }
  const text = field.value.trim();
  if (!text) {
    return;
  }
  field.value = "";
  sendChat(text, true);
});

loadBrand();

field.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (sending) {
      return;
    }
    form.requestSubmit();
  }
});

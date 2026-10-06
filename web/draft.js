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

function usageLine(usage, credits, outcome) {
  if (!usage) {
    return "";
  }
  const tokens = Number(usage.totalTokens) || 0;
  const usd = Number(usage.estCostUsd) || 0;
  const idr = Number(usage.estCostIdr) || 0;
  const cost = tokens === 0 ? "free" : `est. $${usd.toFixed(6)} · Rp${idr.toLocaleString("en-US")}`;
  const charged = credits && typeof credits.chargedCredits === "number" ? `${credits.chargedCredits.toFixed(2)} credits charged` : "";
  const left = credits && typeof credits.credits === "number" ? `Sisa kredit: ${credits.credits.toFixed(2)}` : "";
  return [outcome, `${tokens} tokens`, cost, charged, left].filter(Boolean).join(" · ");
}

function addBubble(role, text, meta) {
  const item = document.createElement("li");
  item.className = `bubble ${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  const time = document.createElement("time");
  time.dateTime = new Date().toISOString();
  time.textContent = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  item.append(paragraph, time);
  if (meta) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = meta;
    item.append(note);
  }
  transcript.append(item);
  item.scrollIntoView({ block: "end" });
}

const tenantParam = new URLSearchParams(location.search).get("tenant")?.trim().toLowerCase() ?? "";
const chip = document.querySelector("#tenant-chip");
const sisa = document.querySelector("#sisa-kredit");
const send = document.querySelector("#send");
const retry = document.querySelector("#retry");
chip.textContent = tenantParam || "demo";

let locked = false;
let lastText = "";

function showSisa(left) {
  if (typeof left !== "number" || Number.isNaN(left)) {
    return;
  }
  sisa.hidden = false;
  sisa.textContent = `Sisa kredit: ${left.toFixed(2)}`;
}

function lockComposer() {
  locked = true;
  field.disabled = true;
  send.disabled = true;
  retry.hidden = false;
}

function unlockComposer() {
  locked = false;
  field.disabled = false;
  send.disabled = false;
  retry.hidden = true;
  field.focus();
}

async function sendChat(text, showVisitor) {
  if (showVisitor) {
    addBubble("visitor", text);
  }
  lastText = text;
  send.disabled = true;
  retry.disabled = true;
  try {
    const headers = { "content-type": "application/json" };
    if (tenantParam) {
      headers["x-tenant-id"] = tenantParam;
    }
    const response = await fetch("/chat", {
      method: "POST",
      headers,
      body: JSON.stringify({ text, draft: readDraft() }),
    });
    const body = await response.json();
    saveDraft(body.draft ?? {});
    const left = typeof body.credits_left === "number" ? body.credits_left : body.credits?.credits;
    if (response.status !== 404) {
      showSisa(left);
    }
    addBubble("agent", body.reply ?? "Tabel harga tidak dapat dibaca.", usageLine(body.usage, body.credits, body.outcome));
    if (response.status === 402 || body.outcome === "402") {
      lockComposer();
      return;
    }
    if (response.ok) {
      unlockComposer();
      return;
    }
    send.disabled = locked;
    if (!locked) {
      field.focus();
    }
  } catch {
    addBubble("agent", "Tabel harga tidak dapat dibaca.");
    send.disabled = locked;
    if (!locked) {
      field.focus();
    }
  } finally {
    retry.disabled = false;
  }
}

const draft = readDraft();
const restored = factsBubble(draft);
addBubble("agent", restored || opening);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (locked) {
    return;
  }
  const text = field.value.trim();
  if (!text) {
    return;
  }
  field.value = "";
  sendChat(text, true);
});

retry.addEventListener("click", () => {
  if (!lastText || retry.disabled) {
    return;
  }
  sendChat(lastText, false);
});

field.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

/**
 * Server-rendered admin page. One refresh script, and no workshop key in the markup.
 * Top-up and new-tenant forms live in dialogs so a refresh can pause while they are open.
 */

import type { ChatRow, Dashboard, HandoffRow, TenantRow, Totals } from "./queries.js";
import { CREDIT_PRICE_IDR, tokensToCredits } from "../workshop/credit-price.js";
import { balanceBadge } from "../workshop/credits.js";

export type AdminNotice =
  | { kind: "topup"; name: string; tenantId: string; credits: number; balanceCredits: number }
  | { kind: "created"; name: string; tenantId: string; credits: number }
  | null;

/** The whole /admin document. */
export function renderAdmin(data: Dashboard, notice: AdminNotice): string {
  const namesJson = JSON.stringify(data.tenants.map((row) => row.name.toLowerCase())).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Credits admin</title>
  <style>
    body { margin: 0; background: #f4f1ea; color: #1c1917; font: 15px/1.45 "Segoe UI", system-ui, sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 28px 24px 72px; }
    h1 { margin: 0 0 6px; font-size: 28px; }
    h2 { margin: 28px 0 10px; font-size: 18px; }
    .card h2, dialog h2, .section-head h2 { margin: 0; }
    p { margin: 0; }
    .lede { color: #44403c; max-width: 70ch; }
    .section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 28px 0 10px; }
    .notice { margin-top: 16px; padding: 10px 12px; background: #ecfccb; border-radius: 8px; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card, table { background: #fff; }
    .card { border-radius: 12px; padding: 16px 18px; }
    .card h2 { margin: 0 0 10px; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 0; }
    dt { color: #57534e; }
    dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
    .cash { margin-top: 12px; color: #44403c; }
    table { width: 100%; border-collapse: collapse; border-radius: 12px; overflow: hidden; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e7e5e4; text-align: left; font-variant-numeric: tabular-nums; vertical-align: top; }
    th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #57534e; }
    tr.flash { animation: rowflash 3s ease; }
    @keyframes rowflash { from { background: #fef9c3; } to { background: transparent; } }
    a { color: #9a3412; }
    button, .text-button { background: #1c1917; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; }
    button.ghost, .text-button.ghost { background: transparent; color: #1c1917; }
    button:disabled { opacity: 0.55; cursor: default; }
    .refresh { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    .refresh input { width: auto; }
    .paused { color: #78716c; margin: 8px 0 0; font-size: 13px; }
    .empty { color: #44403c; padding: 12px 0; }
    .empty button { margin-top: 10px; }
    .slug { color: #78716c; font-size: 12px; }
    .actions { display: flex; gap: 8px; align-items: center; }
    .actions button { padding: 6px 10px; }
    .badge { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 700; }
    .badge.blocked { background: #fee2e2; color: #991b1b; }
    .badge.low { background: #fef3c7; color: #92400e; }
    dialog { border: 0; border-radius: 16px; padding: 20px; width: min(440px, calc(100% - 32px)); box-shadow: 0 16px 40px rgb(28 25 23 / 18%); }
    dialog::backdrop { background: rgb(28 25 23 / 45%); }
    dialog h2 { margin: 0 0 12px; }
    label { display: block; margin: 12px 0 4px; color: #44403c; }
    input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d6d3d1; border-radius: 8px; font: inherit; }
    .presets { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .presets input { width: 8rem; }
    .preset { background: #fff; color: #1c1917; border: 1px solid #d6d3d1; }
    .preview { white-space: pre-line; background: #f5f5f4; border-radius: 8px; padding: 10px 12px; margin-top: 12px; }
    .error { color: #991b1b; margin-top: 6px; }
    .fail { background: #fee2e2; color: #991b1b; border-radius: 8px; padding: 8px 10px; margin-top: 12px; }
    .hint { color: #57534e; margin-top: 8px; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
  </style>
</head>
<body>
<main>
  <h1>Credits admin</h1>
  <p class="lede">One credit is 1,000 tokens and sells for Rp${CREDIT_PRICE_IDR}. Astra Flow cost is shown in USD and in rupiah at 16,500 per dollar. The credit price stays flat when the model rate doubles, so the margin shrinks at peak.</p>
  <label class="refresh"><input id="auto-refresh" type="checkbox" checked> Refresh every 5 seconds</label>
  <p id="refresh-paused" class="paused" hidden>Auto-refresh dijeda</p>
  ${noticeHtml(notice)}
  <section id="totals">
    <div class="cards">
      ${totalsCard("Today (UTC)", data.today)}
      ${totalsCard("All time", data.allTime)}
    </div>
    <p class="cash">Cash in from fake top-ups, separate from earned revenue: today ${rupiah(data.today.cashInIdr)}, all time ${rupiah(data.allTime.cashInIdr)}.</p>
  </section>
  <section id="tenants">
    <div class="section-head">
      <h2>Tenants</h2>
      <button type="button" class="open-create">+ Tenant baru</button>
    </div>
    ${tenantTable(data.tenants, notice?.tenantId ?? "")}
  </section>
  <section id="chats">
    <h2>Last 50 chats</h2>
    <p class="lede">Output tokens include reasoning. Reasoning is the subset reported by the model.</p>
    ${chatTable(data.chats)}
  </section>
  <section id="handoffs">
    <h2>Pending handoffs</h2>
    ${handoffTable(data.handoffs)}
  </section>
  <dialog id="topup-dialog">
    <form id="topup-form" method="post" action="/admin/topup">
      <h2>Top up kredit</h2>
      <p>Tenant: <strong id="topup-name"></strong></p>
      <p>Saldo sekarang: <span id="topup-balance"></span> <span id="topup-badge" class="badge" hidden></span></p>
      <input id="topup-tenant" name="tenant" type="hidden">
      <input id="topup-key" name="idempotency_key" type="hidden">
      <label for="topup-amount">Jumlah kredit</label>
      <div class="presets">
        <button type="button" class="preset" data-preset="5">+5</button>
        <button type="button" class="preset" data-preset="50">+50</button>
        <button type="button" class="preset" data-preset="100">+100</button>
        <input id="topup-amount" name="credits" inputmode="numeric" autocomplete="off" placeholder="Custom">
      </div>
      <p id="topup-error" class="error" hidden></p>
      <div id="topup-preview" class="preview" hidden></div>
      <p id="topup-fail" class="fail" hidden>Gagal menambah kredit. Coba lagi.</p>
      <div class="dialog-actions">
        <button type="button" class="ghost" id="topup-cancel">Batal</button>
        <button type="submit" id="topup-submit" disabled>Tambah kredit</button>
      </div>
    </form>
  </dialog>
  <dialog id="create-dialog">
    <form id="create-form" method="post" action="/admin/tenant">
      <h2>Tenant baru</h2>
      <input id="create-key" name="idempotency_key" type="hidden">
      <label for="create-name">Nama tenant *</label>
      <input id="create-name" name="name" maxlength="60" autocomplete="off">
      <p id="create-name-error" class="error" hidden></p>
      <label for="create-credits">Kredit awal (opsional)</label>
      <input id="create-credits" name="credits" inputmode="numeric" autocomplete="off" value="0">
      <p id="create-credit-error" class="error" hidden></p>
      <p id="create-preview" class="preview">Preview: 0 kredit = 0 token = Rp0</p>
      <p class="hint">Saldo di bawah 2 kredit = chat diblokir sampai di-top up.</p>
      <p id="create-fail" class="fail" hidden>Gagal membuat tenant. Coba lagi.</p>
      <div class="dialog-actions">
        <button type="button" class="ghost" id="create-cancel">Batal</button>
        <button type="submit" id="create-submit">Buat tenant</button>
      </div>
    </form>
  </dialog>
</main>
${adminScript(namesJson)}
</body>
</html>`;
}

function totalsCard(title: string, totals: Totals): string {
  return `<article class="card">
    <h2>${esc(title)}</h2>
    <dl>
      <dt>Tokens</dt><dd>${integer(totals.tokens)}</dd>
      <dt>Real cost</dt><dd>${rupiah(totals.costIdr)}</dd>
      <dt>Earned</dt><dd>${rupiah(totals.earnedIdr)}</dd>
      <dt>Margin</dt><dd>${rupiah(totals.marginIdr)} · ${totals.marginPct.toFixed(1)}%</dd>
    </dl>
  </article>`;
}

function tenantTable(rows: TenantRow[], highlightId: string): string {
  if (rows.length === 0) {
    return `<div class="empty">
      <p>Belum ada tenant.</p>
      <p>Buat tenant pertama untuk mulai mencoba chat.</p>
      <button type="button" class="open-create">+ Tenant baru</button>
    </div>`;
  }
  const body = rows
    .map((row) => {
      const credits = tokensToCredits(row.balanceTokens);
      const badge = balanceBadge(row.balanceTokens);
      const badgeLabel = badge === "blocked" ? "Diblokir" : badge === "low" ? "Hampir habis" : "";
      return `<tr class="${row.tenantId === highlightId ? "flash" : ""}">
        <td><strong>${esc(row.name)}</strong><br><span class="slug">${esc(row.tenantId)}</span></td>
        <td>${credits.toFixed(2)} ${badgeHtml(badge)}<br>${integer(row.balanceTokens)} tokens</td>
        <td>${row.creditsUsed.toFixed(2)}</td>
        <td>${rupiah(row.earnedIdr)}</td>
        <td>${rupiah(row.costIdr)}</td>
        <td>${rupiah(row.marginIdr)}</td>
        <td class="actions">
          <button type="button" class="topup-open" data-tenant="${esc(row.tenantId)}" data-name="${esc(row.name)}" data-tokens="${row.balanceTokens}" data-credits="${credits.toFixed(2)}" data-badge="${esc(badgeLabel)}" data-badge-kind="${badge ?? ""}">Top up</button>
          <a href="/?tenant=${encodeURIComponent(row.tenantId)}" target="_blank" rel="noopener">Chat as</a>
        </td>
      </tr>`;
    })
    .join("");
  return `<table>
    <thead><tr><th>Tenant</th><th>Balance</th><th>Credits used</th><th>Earned</th><th>Cost</th><th>Margin</th><th>Chat</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function badgeHtml(badge: "blocked" | "low" | null): string {
  switch (badge) {
    case "blocked":
      return `<span class="badge blocked">Diblokir</span>`;
    case "low":
      return `<span class="badge low">Hampir habis</span>`;
    case null:
      return "";
    default: {
      const unexpected: never = badge;
      throw new Error(`unexpected badge ${JSON.stringify(unexpected)}`);
    }
  }
}

function chatTable(rows: ChatRow[]): string {
  if (rows.length === 0) {
    return `<p class="empty">No chats yet.</p>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.time)}</td>
        <td>${esc(row.tenantId)}</td>
        <td>${esc(row.outcome)}</td>
        <td>${integer(row.promptTokens)}</td>
        <td>${integer(row.completionTokens)}</td>
        <td>${integer(row.reasoningTokens)}</td>
        <td>${rupiah(row.costIdr)}</td>
        <td>${row.chargedCredits.toFixed(2)}</td>
        <td>${row.peak ? "peak" : "off-peak"}</td>
      </tr>`,
    )
    .join("");
  return `<table>
    <thead><tr><th>Time</th><th>Tenant</th><th>Outcome</th><th>Input</th><th>Output</th><th>Reasoning</th><th>Cost</th><th>Credits</th><th>Peak</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function handoffTable(rows: HandoffRow[]): string {
  if (rows.length === 0) {
    return `<p class="empty">No pending handoffs.</p>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.createdAt)}</td>
        <td>${esc(row.commodity)}</td>
        <td>${esc(row.province)}</td>
        <td>${rupiah(row.displayedPrice)}</td>
        <td>${rupiah(row.claimedPrice)}</td>
      </tr>`,
    )
    .join("");
  return `<table>
    <thead><tr><th>Time</th><th>Commodity</th><th>Province</th><th>Displayed</th><th>Claimed</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function noticeHtml(notice: AdminNotice): string {
  if (!notice) {
    return "";
  }
  const body = notice.kind === "topup"
    ? esc(`+${notice.credits} kredit ditambahkan ke ${notice.name}. Saldo baru: ${notice.balanceCredits.toFixed(2)} kredit.`)
    : `${esc(`Tenant "${notice.name}" dibuat · saldo ${wholeCredits(notice.credits)} kredit.`)} <a href="/?tenant=${encodeURIComponent(notice.tenantId)}" target="_blank" rel="noopener">Chat as</a>`;
  return `<p class="notice" id="banner"><span>${body}</span><button type="button" id="banner-close" class="ghost" aria-label="Close">✕</button></p>`;
}

function wholeCredits(credits: number): string {
  return Number.isInteger(credits) ? String(credits) : credits.toFixed(2);
}

function adminScript(namesJson: string): string {
  return `<script>
(function () {
  var box = document.getElementById("auto-refresh");
  var paused = document.getElementById("refresh-paused");
  var topupDialog = document.getElementById("topup-dialog");
  var createDialog = document.getElementById("create-dialog");
  var takenNames = ${namesJson};
  var banner = document.getElementById("banner");

  function dialogOpen() {
    return Boolean((topupDialog && topupDialog.open) || (createDialog && createDialog.open));
  }
  function syncPause() {
    if (paused) paused.hidden = !dialogOpen();
  }
  if (box) {
    if (sessionStorage.getItem("admin-refresh") === "off") box.checked = false;
    box.addEventListener("change", function () {
      sessionStorage.setItem("admin-refresh", box.checked ? "on" : "off");
    });
    setInterval(function () {
      syncPause();
      if (!box.checked || dialogOpen()) return;
      location.reload();
    }, 5000);
  }
  if (banner) {
    var closeBanner = document.getElementById("banner-close");
    if (closeBanner) closeBanner.addEventListener("click", function () { banner.hidden = true; });
    setTimeout(function () { banner.hidden = true; }, 6000);
  }

  function grouped(value) {
    return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(value);
  }
  function creditError(raw, allowZero) {
    var trimmed = String(raw).trim();
    if (trimmed === "") return allowZero ? "" : "Isi jumlah kredit.";
    if (!/^\\d+$/.test(trimmed)) return "Jumlah harus bilangan bulat lebih dari 0.";
    var count = Number(trimmed);
    if (count === 0 && !allowZero) return "Jumlah harus bilangan bulat lebih dari 0.";
    if (count > 10000) return "Maksimal 10.000 kredit per top up.";
    return "";
  }
  function slugFrom(name) {
    var slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
    return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(slug) ? slug : "";
  }
  function nameError(raw) {
    var name = String(raw).trim();
    if (name === "") return "Isi nama tenant.";
    if (name.length < 2 || name.length > 60 || !slugFrom(name)) return "Nama 2–60 karakter.";
    if (takenNames.indexOf(name.toLowerCase()) !== -1) return "Nama tenant sudah dipakai.";
    return "";
  }
  function sendForm(form, fail, restore) {
    fetch(form.action, { method: "POST", headers: { accept: "application/json" }, body: new FormData(form) })
      .then(function (response) {
        return response.json().then(function (body) { return { ok: response.ok, status: response.status, body: body }; });
      })
      .then(function (result) {
        if (result.ok && result.body && result.body.redirect) {
          location.assign(result.body.redirect);
          return;
        }
        restore();
        var message = result.body && result.body.error ? result.body.error : "";
        var inline = form.querySelector(".error");
        if (result.status === 400 && message && inline) {
          inline.hidden = false;
          inline.textContent = message;
          fail.hidden = true;
          return;
        }
        fail.hidden = false;
      })
      .catch(function () {
        fail.hidden = false;
        restore();
      });
  }

  var amount = document.getElementById("topup-amount");
  var topupError = document.getElementById("topup-error");
  var topupPreview = document.getElementById("topup-preview");
  var topupSubmit = document.getElementById("topup-submit");
  var topupFail = document.getElementById("topup-fail");
  var topupForm = document.getElementById("topup-form");
  var currentTokens = 0;
  function paintTopup() {
    var message = creditError(amount.value, false);
    topupError.hidden = message === "";
    topupError.textContent = message;
    if (message === "") {
      var count = Number(String(amount.value).trim());
      var next = ((currentTokens + count * 1000) / 1000).toFixed(2);
      topupPreview.hidden = false;
      topupPreview.textContent = "+" + count + " kredit = " + grouped(count * 1000) + " token = Rp" + grouped(count * 100) + "\\nSaldo baru: " + next + " kredit";
      topupSubmit.disabled = false;
      topupSubmit.textContent = "Tambah " + count + " kredit";
      return;
    }
    topupPreview.hidden = true;
    topupSubmit.disabled = true;
    topupSubmit.textContent = "Tambah kredit";
  }
  document.querySelectorAll(".topup-open").forEach(function (button) {
    button.addEventListener("click", function () {
      currentTokens = Number(button.getAttribute("data-tokens")) || 0;
      document.getElementById("topup-name").textContent = button.getAttribute("data-name") || "";
      document.getElementById("topup-balance").textContent = (button.getAttribute("data-credits") || "0.00") + " kredit";
      var badge = document.getElementById("topup-badge");
      var label = button.getAttribute("data-badge") || "";
      badge.textContent = label;
      badge.className = "badge " + (button.getAttribute("data-badge-kind") || "");
      badge.hidden = label === "";
      document.getElementById("topup-tenant").value = button.getAttribute("data-tenant") || "";
      document.getElementById("topup-key").value = crypto.randomUUID();
      amount.value = "";
      topupFail.hidden = true;
      paintTopup();
      topupDialog.showModal();
      syncPause();
    });
  });
  document.querySelectorAll("[data-preset]").forEach(function (button) {
    button.addEventListener("click", function () {
      amount.value = button.getAttribute("data-preset") || "";
      paintTopup();
    });
  });
  if (amount) amount.addEventListener("input", paintTopup);
  document.getElementById("topup-cancel").addEventListener("click", function () { topupDialog.close(); });
  topupDialog.addEventListener("close", syncPause);
  topupForm.addEventListener("submit", function (event) {
    event.preventDefault();
    if (creditError(amount.value, false)) return;
    topupSubmit.disabled = true;
    topupSubmit.textContent = "Menambahkan…";
    topupFail.hidden = true;
    sendForm(topupForm, topupFail, paintTopup);
  });

  var createName = document.getElementById("create-name");
  var createCredits = document.getElementById("create-credits");
  var createNameError = document.getElementById("create-name-error");
  var createCreditError = document.getElementById("create-credit-error");
  var createPreview = document.getElementById("create-preview");
  var createSubmit = document.getElementById("create-submit");
  var createFail = document.getElementById("create-fail");
  var createForm = document.getElementById("create-form");
  function paintCreate() {
    var message = nameError(createName.value);
    var creditMessage = creditError(createCredits.value, true);
    createNameError.hidden = message === "";
    createNameError.textContent = message;
    createCreditError.hidden = creditMessage === "";
    createCreditError.textContent = creditMessage;
    if (creditMessage === "") {
      var count = String(createCredits.value).trim() === "" ? 0 : Number(String(createCredits.value).trim());
      createPreview.textContent = "Preview: " + count + " kredit = " + grouped(count * 1000) + " token = Rp" + grouped(count * 100);
    }
    createSubmit.disabled = message !== "" || creditMessage !== "";
    if (createSubmit.textContent === "Membuat…") createSubmit.textContent = "Buat tenant";
  }
  function openCreate() {
    document.getElementById("create-key").value = crypto.randomUUID();
    createName.value = "";
    createCredits.value = "0";
    createFail.hidden = true;
    paintCreate();
    createDialog.showModal();
    syncPause();
  }
  document.querySelectorAll(".open-create").forEach(function (button) {
    button.addEventListener("click", openCreate);
  });
  createName.addEventListener("input", paintCreate);
  createCredits.addEventListener("input", paintCreate);
  document.getElementById("create-cancel").addEventListener("click", function () { createDialog.close(); });
  createDialog.addEventListener("close", syncPause);
  createForm.addEventListener("submit", function (event) {
    event.preventDefault();
    paintCreate();
    if (createSubmit.disabled) return;
    createSubmit.disabled = true;
    createSubmit.textContent = "Membuat…";
    createFail.hidden = true;
    sendForm(createForm, createFail, function () {
      createSubmit.textContent = "Buat tenant";
      paintCreate();
    });
  });
})();
</script>`;
}

function rupiah(amount: number): string {
  return `Rp${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function integer(amount: number): string {
  return amount.toLocaleString("en-US");
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

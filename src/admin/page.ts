/**
 * Server-rendered admin page. One refresh script, and no workshop key in the markup.
 */

import type { ChatRow, Dashboard, HandoffRow, TenantRow, Totals } from "./queries.js";
import { CREDIT_PRICE_IDR } from "../workshop/credit-price.js";

export type AdminNotice =
  | { kind: "topped"; tenantId: string; credits: number }
  | { kind: "created"; tenantId: string; credits: number }
  | { kind: "exists"; tenantId: string }
  | { kind: "missing"; tenantId: string }
  | { kind: "invalid" }
  | null;

/** The whole /admin document. */
export function renderAdmin(data: Dashboard, notice: AdminNotice): string {
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
    p { margin: 0; }
    .lede { color: #44403c; max-width: 70ch; }
    .notice { margin-top: 16px; padding: 10px 12px; background: #ecfccb; border-radius: 8px; }
    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .card, .panel, table { background: #fff; }
    .card, .panel { border-radius: 12px; padding: 16px 18px; }
    .card h2 { margin: 0 0 10px; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 0; }
    dt { color: #57534e; }
    dd { margin: 0; font-variant-numeric: tabular-nums; text-align: right; }
    .cash { margin-top: 12px; color: #44403c; }
    table { width: 100%; border-collapse: collapse; border-radius: 12px; overflow: hidden; }
    th, td { padding: 8px 10px; border-bottom: 1px solid #e7e5e4; text-align: left; font-variant-numeric: tabular-nums; vertical-align: top; }
    th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #57534e; }
    .forms { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    label { display: block; margin: 10px 0 4px; color: #44403c; }
    input { width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #d6d3d1; border-radius: 8px; font: inherit; }
    button { margin-top: 12px; background: #1c1917; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; font: inherit; cursor: pointer; }
    .presets { display: flex; flex-wrap: wrap; gap: 8px; }
    a { color: #9a3412; }
    .refresh { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    .refresh input { width: auto; }
    .empty { color: #78716c; padding: 12px 0; }
  </style>
</head>
<body>
<main>
  <h1>Credits admin</h1>
  <p class="lede">One credit is 1,000 tokens and sells for Rp${CREDIT_PRICE_IDR}. Astra Flow cost is shown in USD and in rupiah at 16,500 per dollar. The credit price stays flat when the model rate doubles, so the margin shrinks at peak.</p>
  <label class="refresh"><input id="auto-refresh" type="checkbox" checked> Refresh every 5 seconds</label>
  ${noticeHtml(notice)}
  <section id="totals">
    <div class="cards">
      ${totalsCard("Today (UTC)", data.today)}
      ${totalsCard("All time", data.allTime)}
    </div>
    <p class="cash">Cash in from fake top-ups, separate from earned revenue: today ${rupiah(data.today.cashInIdr)}, all time ${rupiah(data.allTime.cashInIdr)}.</p>
  </section>
  <section id="tenants">
    <h2>Tenants</h2>
    ${tenantTable(data.tenants)}
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
  <section class="forms">
    <form id="topup" class="panel" method="post" action="/admin/topup">
      <h2>Fake top-up</h2>
      <label for="topup-tenant">Tenant</label>
      <input id="topup-tenant" name="tenant" required maxlength="40" autocomplete="off">
      <label for="topup-credits">Credits</label>
      <input id="topup-credits" name="credits" type="number" min="1" step="1" placeholder="Custom">
      <div class="presets">
        <button type="submit" name="preset" value="5">+5</button>
        <button type="submit" name="preset" value="50">+50</button>
        <button type="submit">Add credits</button>
      </div>
    </form>
    <form id="new-tenant" class="panel" method="post" action="/admin/tenant">
      <h2>New tenant</h2>
      <label for="new-tenant-id">Tenant id</label>
      <input id="new-tenant-id" name="tenant" required maxlength="40" autocomplete="off">
      <label for="new-tenant-credits">Starting credits</label>
      <input id="new-tenant-credits" name="credits" type="number" min="0" step="1" value="0" required>
      <button type="submit">Create tenant</button>
    </form>
  </section>
</main>
<script>
(function () {
  var box = document.getElementById("auto-refresh");
  if (!box) return;
  if (sessionStorage.getItem("admin-refresh") === "off") box.checked = false;
  box.addEventListener("change", function () {
    sessionStorage.setItem("admin-refresh", box.checked ? "on" : "off");
  });
  setInterval(function () {
    if (!box.checked) return;
    var active = document.activeElement;
    if (active && active.closest && active.closest("form")) return;
    location.reload();
  }, 5000);
})();
</script>
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

function tenantTable(rows: TenantRow[]): string {
  if (rows.length === 0) {
    return `<p class="empty">No tenants yet.</p>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
        <td>${esc(row.tenantId)}</td>
        <td>${row.balanceCredits.toFixed(2)}<br>${integer(row.balanceTokens)} tokens</td>
        <td>${row.creditsUsed.toFixed(2)}</td>
        <td>${rupiah(row.earnedIdr)}</td>
        <td>${rupiah(row.costIdr)}</td>
        <td>${rupiah(row.marginIdr)}</td>
        <td><a href="/?tenant=${encodeURIComponent(row.tenantId)}" target="_blank" rel="noopener">Chat as</a></td>
      </tr>`,
    )
    .join("");
  return `<table>
    <thead><tr><th>Tenant</th><th>Balance</th><th>Credits used</th><th>Earned</th><th>Cost</th><th>Margin</th><th>Chat</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
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
  return `<p class="notice">${esc(noticeText(notice))}</p>`;
}

function noticeText(notice: Exclude<AdminNotice, null>): string {
  switch (notice.kind) {
    case "topped":
      return `Added ${notice.credits.toFixed(2)} credits to ${notice.tenantId}.`;
    case "created":
      return `Created ${notice.tenantId} with ${notice.credits.toFixed(2)} credits.`;
    case "exists":
      return `${notice.tenantId} already exists.`;
    case "missing":
      return `${notice.tenantId} was not found. Create it first.`;
    case "invalid":
      return "Check the tenant id and the credit amount.";
    default: {
      const unexpected: never = notice;
      throw new Error(`unexpected notice ${JSON.stringify(unexpected)}`);
    }
  }
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

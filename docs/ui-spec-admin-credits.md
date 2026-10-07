# astra-cs: admin credits + customer chat UI spec (decided)

Owner: UI/UX Designer · For: Software Engineer, QA Engineer
Freeze: Thu 8 Oct 2026 · Live demo: Fri 9 Oct (AstraFlow workshop)
Stack: plain server-rendered HTML on a Cloudflare Worker. Small inline JS is fine. No framework.
Credit model (unchanged): 1 kredit = 1.000 token = Rp100. Blocked (402) under 2 kredit. New tenants start at 0.

Keep as is: the totals, tenants table columns, last 50 chats, pending handoffs, and "Chat as".
Changed: top-up flow, new-tenant flow, low-balance badges, auto-refresh pause, and everything billing-related on the customer chat.

---

## A. Admin: top-up (give credit)

### Where it lives
- Per-row action. Add a **`Top up`** button to each tenant row, next to "Chat as".
- Remove the standalone fake top-up form. A form that isn't tied to a row is how credit goes to the wrong tenant.

### Interaction
Clicking `Top up` opens a native `<dialog>` modal (no library).

```
┌ Top up kredit ─────────────────────────────┐
│ Tenant: Warung Bu Sri                       │
│ Saldo sekarang: 1.20 kredit  [Diblokir]     │
│                                             │
│ Jumlah kredit                               │
│ ( +5 ) ( +50 ) ( +100 )  [ custom ____ ]    │
│                                             │
│ ┌ Preview ─────────────────────────────┐    │
│ │ +50 kredit = 50.000 token = Rp5.000  │    │
│ │ Saldo baru: 51.20 kredit             │    │
│ └──────────────────────────────────────┘    │
│                                             │
│            [ Batal ]  [ Tambah 50 kredit ]  │
└─────────────────────────────────────────────┘
```

- Preset chips: `+5`, `+50`, `+100`. Picking one fills the custom field. The custom field accepts whole numbers only.
- The preview updates live (JS) as the amount changes. Format: `+{n} kredit = {n×1000} token = Rp{n×100}` plus `Saldo baru: {saldo+n} kredit`. Use Indonesian number formatting (`50.000`, `Rp5.000`).
- The primary button label includes the amount, e.g. `Tambah 50 kredit`. It's disabled until the amount is valid.
- This preview is the confirmation step. There's no second "are you sure" dialog, because the preview plus the amount in the button label already confirm.

### Validation (client side and server side)
| Case | Inline error under the field |
|---|---|
| Empty | `Isi jumlah kredit.` |
| Not a whole number, ≤ 0 | `Jumlah harus bilangan bulat lebih dari 0.` |
| > 10.000 | `Maksimal 10.000 kredit per top up.` |
| Tenant no longer exists (server) | `Tenant tidak ditemukan. Muat ulang halaman.` |

The server re-validates everything and never trusts the client.

### Double-submit prevention
- On submit, disable the button and change its label to `Menambahkan…`.
- Each dialog open renders a hidden one-time `idempotency_key`. The server ignores a repeated key (it returns the same success without crediting twice).

### Feedback
- Success uses Post/Redirect/Get. Redirect to `/admin?ok=topup&tenant=…`, then show a green banner at the top:
  `+50 kredit ditambahkan ke Warung Bu Sri. Saldo baru: 51.20 kredit.`
  The tenant row gets a brief highlight (about 3 s). The banner auto-hides after 6 s or on ✕.
- Server error: the dialog stays open, the amount is kept, and a red inline banner says `Gagal menambah kredit. Coba lagi.`

## B. Admin: new tenant

### Where it lives
- A **`+ Tenant baru`** button in the Tenants section header, right-aligned. It opens a `<dialog>`.
- Remove the always-visible new-tenant form.

```
┌ Tenant baru ───────────────────────────────┐
│ Nama tenant *                               │
│ [ Warung Bu Sri                    ]        │
│                                             │
│ Kredit awal (opsional)                      │
│ [ 0 ]                                       │
│ Preview: 0 kredit = 0 token = Rp0           │
│ ⓘ Saldo di bawah 2 kredit = chat diblokir   │
│   sampai di-top up.                         │
│                                             │
│                 [ Batal ]  [ Buat tenant ]  │
└─────────────────────────────────────────────┘
```

- Name: required, 2–60 characters, trimmed, unique (case-insensitive).
- Initial credits: default `0`. Same rules and live preview as top-up. 0 is allowed.
- Keep whatever tenant ID the system already generates. Don't add a new slug field.
- Validation copy:
  - `Isi nama tenant.`
  - `Nama 2–60 karakter.`
  - `Nama tenant sudah dipakai.`
  - Credit errors are the same as for top-up.
- Double submit: same idempotency key, and the button shows `Membuat…`.
- Success (PRG): banner `Tenant "Warung Bu Sri" dibuat · saldo 0 kredit.` with an inline `Chat as` link. The new row appears at the top of the table, highlighted.

### Empty state (tenants table, 0 rows)
```
Belum ada tenant.
Buat tenant pertama untuk mulai mencoba chat.
[ + Tenant baru ]
```

## C. Admin: balance badges (small and demo-friendly)
Add these in the Balance cell next to the number:
- `< 2` kredit: red badge **`Diblokir`**
- `2–10` kredit: amber badge **`Hampir habis`**
- Above 10: no badge

## D. Admin: auto-refresh vs dialogs (must fix)
A 5 s auto-refresh will wipe an open dialog mid-typing.
- Pause auto-refresh while any dialog is open, and resume when it closes.
- While paused, show a small muted label near the header: `Auto-refresh dijeda`.
- If the refresh is a full meta-refresh, switch it to a JS timer (or a fetch-and-swap of sections) so it can be paused.

---

## E. Customer chat: no billing UI

### Remove
- The per-reply line (`answered · 798 tokens · est. $… · Rp13 · 0.80 credits charged`).
- `Sisa kredit: X.XX`.
- Any token, cost, or credit wording anywhere on the customer page, including the 402 copy.

### Tenant chip: keep, but reword it as branding
- Show the tenant name as a plain label in the header: `Dukungan Monitor Pangan · Warung Bu Sri`.
- Don't show the word "tenant", IDs, or a chip with a border.
- Reason: the end customer is talking to that business, and during the demo the audience can see which tenant "Chat as" switched to.

### Out of credits (402)
Render it as a system notice in the thread, in place of the assistant reply. Use a neutral grey bubble, not red:

> **Maaf, layanan chat sedang tidak tersedia.**
> Silakan coba lagi beberapa saat lagi.
> [ Coba lagi ]

- `Coba lagi` re-sends the same customer message. The input stays enabled.
- No "kredit", "top up", "admin", or "402".
- Demo beat: the chat blocks, the presenter tops up in /admin, clicks `Coba lagi`, and the chat answers.

Other errors (network/500): `Maaf, terjadi gangguan. Coba lagi.` + `Coba lagi`. It's visually the same, and the copy differs only so QA can tell the cases apart.

### Debug toggle: no
- Don't add a hidden debug toggle to the customer chat for this demo. It's another surface that can leak billing on a projector, and it adds scope before the freeze.
- The token-drop story lives in /admin. Recommended stage layout: chat on the left half and `/admin` on the right half, with the 5 s auto-refresh. The newest row in "Last 50 chats" plus the tenant balance and badge do the storytelling.

---

## F. Acceptance criteria (QA, screenshot each)

Admin
1. Each tenant row shows a `Top up` button. No standalone top-up form remains.
2. Choosing `+50` on a tenant at 1.20 shows the preview `+50 kredit = 50.000 token = Rp5.000` and `Saldo baru: 51.20 kredit`. The button reads `Tambah 50 kredit`.
3. A custom `0`, `-3`, `2.5`, empty, or `10001` shows the matching inline error with the button disabled. The server also rejects these via a crafted POST.
4. A fast double-click on confirm credits exactly once (balance +50, not +100).
5. Success shows the green banner with tenant name and new balance. The row is highlighted, and refreshing the page doesn't re-submit.
6. While a dialog is open, the page doesn't refresh for ≥ 15 s and `Auto-refresh dijeda` is visible. After close, refresh resumes.
7. `+ Tenant baru` with an empty name or a duplicate name shows the right error. A valid name with initial credit 0 creates a row at the top with balance 0 and a `Diblokir` badge.
8. With zero tenants, the empty state and its button appear.
9. Badges: 1.5 shows `Diblokir`, 5 shows `Hampir habis`, and 50 shows none.

Customer chat
10. A normal reply shows no tokens, $, Rp, "credits", or "Sisa kredit" anywhere (view the page source too).
11. The header shows the tenant name as plain text, with no "tenant" word or ID.
12. Under 2 credits, sending shows exactly `Maaf, layanan chat sedang tidak tersedia.` / `Silakan coba lagi beberapa saat lagi.` + `Coba lagi`, with no billing words.
13. After an admin top-up, `Coba lagi` gets a real answer, and /admin shows the new chat row and the balance drop within about 5 s.

Out of scope: real payments, roles/auth changes, a redesign of the totals, chats, or handoffs sections, and a customer debug mode.

# Astra CS (Monitor Pangan support agent)

Workshop lab branch for **How to Start Building an AI SaaS for Enterprise with AstraFlow** (Aldi x UCLOUD Global). This is the finished app from [`main`](https://github.com/naufaldi/astra-cs) with **eight planted bugs**. Everything else is identical to `main`. Clone it, run the tests, and fix the bugs until everything is green.

```bash
git clone -b workshop-broken https://github.com/naufaldi/astra-cs.git
cd astra-cs
npm install
npm test                # starts red: 30 failing tests, all from the 8 bugs
npm run test:exercise   # starts red: identity gate (bug 8)
npm run check           # type check passes; the bugs are behaviour, not types
```

Green on all three means you fixed every bug. Stuck? `git diff workshop-broken origin/main -- src web` shows the reference fixes. `src/agent/extra-guardrail.ts` is an empty hook for one more rule (bonus).

## What's broken

Fix them in any order. Each row lists the symptom you will see and the test that goes red. The hint points the way, not the fix.

| # | File | Symptom | Test that catches it | Hint |
| --- | --- | --- | --- | --- |
| 1 | `src/agent/phrase.ts` | Every AstraFlow call fails (404 / wrong response shape); answers never come from the model. | `test/handle-request.test.ts` > "posts to the AstraFlow chat completions endpoint" | AstraFlow is OpenAI-compatible. Which path takes a `messages` array? |
| 2 | `web/draft.js` | The chat page calls AstraFlow straight from the browser with a key in the JS bundle; anyone can open DevTools and copy it. | `test/browser-key.test.ts` > "the chat page talks to the Worker, never to AstraFlow" | The browser should only ever talk to your own Worker route. The key lives in `.dev.vars` / a Worker secret. |
| 3 | `src/agent/phrase.ts` | AstraFlow answers `400 param_error`; `ASTRAFLOW_MODEL` is ignored. | `test/handle-request.test.ts` > "calls AstraFlow with the default DeepSeek V4 model unless overridden" | Check the model id the gateway actually serves, and whether the override is read at all. |
| 4 | `src/workshop/token-usage.ts` | Every answer logs 0 tokens and the tenant is never charged. | `test/workshop.test.ts` > "reads usage from a model reply" (+ credit tests in `test/admin-credits.test.ts`) | Print the raw `usage` object from a real response. How are its keys spelled? |
| 5 | `src/workshop/token-usage.ts`, `src/workshop/cost-projection.ts` | Cost per call is off by orders of magnitude, peak hours cost the same as off-peak, and `npm run cost:estimate` prints nonsense. | `test/workshop.test.ts` > "prices the catalog windows and keeps the API total", "prints 1,000, 10,000, and 100,000 chats..."; `test/admin-credits.test.ts` > "prices peak at twice the off-peak cost..." | Prices are per **million** tokens. Which rate goes with prompt tokens, which with completion? Is the peak rate ever picked? |
| 6 | `src/workshop/charge-credits.ts` | A tenant with 0.5 credits can still ask; the 402 never appears until the balance is exactly 0. | `test/admin-credits.test.ts` > "opens the gate at 2,000 tokens..."; `test/workshop.test.ts` > "...returns 402 under two credits..." | The gate is 2 credits, and `credit-price.ts` already exports the number. |
| 7 | `src/agent/phrase.ts`, `src/agent/handle-request.ts` | An AstraFlow 429, 5xx or slow response crashes the request or hangs it; the visitor gets an error instead of an answer. | `test/handle-request.test.ts` > "answers from the template when AstraFlow ... timeout", "wording path > is fallback..."; `test/workshop.test.ts` > "...logs wording_fallback when AstraFlow is down" | Read ADR 0014. Check `response.ok`, give the call a timeout, and fall back to the fact template without charging. |
| 8 | `src/agent/phrase.ts`, `src/agent/handle-request.ts` | The model gets a generic prompt plus the visitor's raw text (names, phone numbers leak, prices are made up), and a "the price is wrong" claim is never recorded for human review. | `npm run test:exercise` (identity gate); `test/handle-request.test.ts` > "wording prompt > ...", "records a follow-up claim..."; `test/guardrails.test.ts` > "casual price claims > ..." | Send only the resolved facts as JSON with a strict system prompt. A claim must write a handoff record before replying. |

## Original app description

A Cloudflare Worker that answers Indonesian food-price questions from one published price table, phrases the answer through AstraFlow (an OpenAI-style chat gateway), and bills each tenant in credits.

What it shows:

- `POST /chat` resolves a question, reads the price table through an in-Worker MCP tool, and asks AstraFlow to phrase the answer.
- Refusals (off-topic, trends, unpublished dates) and claim handoffs never call the model and cost nothing.
- Every answered call is metered. One credit is 1,000 tokens, charged at Rp100. A tenant needs at least 2 credits to ask.
- `/admin` shows usage, creates tenants, and tops up credits.
- `npm run cost:estimate` projects monthly cost for 1,000, 10,000 and 100,000 chats.

## Tech stack

- Cloudflare Workers, written in TypeScript, run locally with `wrangler dev` (wrangler 4).
- Cloudflare D1 (SQLite) for tenants, the credit ledger, request usage, handoff records and admin logins. Schema lives in `migrations/`.
- Static chat page in `web/` (plain HTML, CSS and JavaScript, served as Worker assets).
- Price read through an in-Worker MCP tool (`@modelcontextprotocol/sdk`) that fetches `https://monitor.naufaldi.com/api/pihps/fresh`.
- AstraFlow, an OpenAI-compatible chat gateway at `https://api-sg.umodelverse.ai`. The lab is about getting that call right.
- zod for input schemas, vitest for tests, `tsc --noEmit` for type checks. Tests run D1 queries on in-memory `node:sqlite`.

## Project layout

| Path | What is there |
| --- | --- |
| `src/index.ts`, `src/routes.ts` | Worker entry and HTTP routes. |
| `src/agent/` | Question resolving, refusals, wording call to AstraFlow, wording check, handoff records, request log. |
| `src/mcp/` | The MCP server, client, live price read and price cache. |
| `src/workshop/` | Credits, charging, token usage, request-usage log and the cost projection. |
| `src/admin/` | `/admin` page, login check and dashboard queries. |
| `web/` | The chat page. |
| `migrations/` | D1 migrations 0001-0006. |
| `scripts/` | `cost-estimate.ts` and its runner. |
| `test/` | vitest suites. |
| `docs/adr/`, `CONTEXT.md` | Decisions and the project vocabulary. |

## HTTP routes

| Route | Purpose |
| --- | --- |
| `POST /chat` | One visitor message. Optional header `x-tenant-id`; no header means the `demo` tenant. |
| `GET /brand?tenant=` | Display name for a tenant. |
| `/mcp` | The price-table MCP endpoint. |
| `GET /admin`, `POST /admin/tenant`, `POST /admin/topup` | Dashboard, new tenant, top-up. HTTP Basic login. |
| `GET /credits`, `GET /handoff` | JSON lists, need header `x-workshop-key`. |
| everything else | Static files from `web/`. |

## Setup

Needs Node 22.13 or newer (tests use `node:sqlite`) and network access to `monitor.naufaldi.com`, the live price source.

```bash
npm install
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` (git ignores it). These are the variable names the Worker reads:

| Name | Purpose |
| --- | --- |
| `ASTRAFLOW_API_KEY` | AstraFlow key. Keep it in `.dev.vars` or a Worker secret. The browser must not see it. |
| `ASTRAFLOW_MODEL` | Optional override. Once bug 3 is fixed, blank or unset uses `deepseek-v4.1-flash` (DeepSeek V4.1 flash). |
| `ASTRAFLOW_THINKING` | Optional. Thinking is off by default, so an answer uses about 135 tokens in total (105 prompt, 31 completion). Set `on` to let the model reason first; that adds hundreds of reasoning tokens and several seconds. |
| `WORKSHOP_KEY` | Optional. Header `x-workshop-key` for `/credits` and `/handoff`. |

Create the local database and start the Worker:

```bash
npm run db:migrate:local
npm run dev
```

Open http://localhost:8787. The migrate command only touches the local database under `.wrangler/`. The `wrangler*.jsonc` files point at the owner's Cloudflare D1 database. To deploy your own copy, create a D1 database and put its id in them first. Local runs do not need that.

## Ten-minute demo

1. Ask `Berapa harga beras premium di Jawa Barat?` and then `What is the price of cooking oil in Papua?`. The reply names the trading date, and the language follows the question.
2. Ask `Provinsi mana yang paling murah untuk bawang merah?` for a ranking.
3. Ask `Siapa presiden?` to see a free refusal.
4. Say the displayed price is wrong (`Harga beras di Jawa Barat harusnya Rp9.000`) to write a handoff record with no model call.
5. Open http://localhost:8787/admin (locally `admin` / `admin`). Create a tenant such as `Acme` with 3 credits.
6. Chat as that tenant at `http://localhost:8787/?tenant=acme`. Once bugs 4-6 are fixed, each answer costs about 0.1 credit and the gate needs 2 credits on the balance. A tenant with 2 credits gets one answer and then a 402. With 3 credits (3,000 tokens) and about 135 tokens per answer it gets about 8 answers before the balance drops under the 2,000-token gate. Top up from `/admin` and ask again.
7. Run `npm run cost:estimate` for the slide numbers.

The built-in `demo` tenant starts with 50 credits, which is too many to drain live. Use a fresh tenant with 2 credits for a quick out-of-credits moment (3 if you want a few answers first).

## When AstraFlow fails

Once bug 7 is fixed, a 429, a 5xx, a timeout or an empty completion from AstraFlow never reaches the visitor as an error. The Worker answers from the fact template instead, charges nothing, and logs `errorClass: wording_fallback` with the upstream class and a redacted message (ADR 0014). A model sentence that drops a price or the date is replaced by the template too (`wording_rejected`).

## Cost estimate

```bash
npm run cost:estimate
npm run cost:estimate -- --prompt 105 --completion 31 --share 0.5
npm run cost:estimate -- --prompt 130 --completion 746 --reasoning 700
```

With no flags it averages the answered rows in local D1 (`npm run db:migrate:local`, chat a few times, rerun). On a fresh clone it prints a labelled example instead. The rupiah figures use a fixed workshop rate of 16,500 per USD. Peak (2x) and off-peak columns are both shown; the numbers are only right once bug 5 is fixed.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Worker locally with `wrangler dev`. |
| `npm run db:migrate:local` | Apply D1 migrations to the local database. |
| `npm test` | Run the app's own vitest suite. |
| `npm run test:exercise` | Run `test/exercise/` (identity gate). Red until bug 8 is fixed. |
| `npm run check` | Type-check with `tsc --noEmit`. |
| `npm run cost:estimate` | Print the monthly cost projection. |
| `npm run types` | Regenerate `worker-configuration.d.ts` with `wrangler types`. |
| `npm run deploy` | `wrangler deploy` with `wrangler.jsonc`. It publishes to the owner's Cloudflare account, so skip it unless that is what you want. |

## Tests

```bash
npm test
npm run test:exercise
npm run check
```

`test/exercise/identity-gate.test.ts` is the bonus. A name and a phone must stay out of the AstraFlow payload, the log, and storage. It is green on `main` and red on `workshop-broken`.

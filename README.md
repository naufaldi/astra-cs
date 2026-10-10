# Astra CS (Monitor Pangan support agent)

Finished reference app for **How to Start Building an AI SaaS for Enterprise with AstraFlow** (Aldi x UCLOUD Global). Every lab bug is fixed on this branch (`main`) and all tests are green.

**Doing the hands-on lab?** Use the [`workshop-broken`](https://github.com/naufaldi/astra-cs/tree/workshop-broken) branch instead. It is this exact app with eight planted bugs, and its README lists each one (file, symptom, catching test, hint):

```bash
git clone -b workshop-broken https://github.com/naufaldi/astra-cs.git
```

`src/agent/extra-guardrail.ts` is the empty hook for one more rule (bonus).

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
| `ASTRAFLOW_MODEL` | Optional override. Blank or unset uses `deepseek-v4.1-flash` (DeepSeek V4.1 flash). |
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
6. Chat as that tenant at `http://localhost:8787/?tenant=acme`. Each answer costs about 0.1 credit and the gate needs 2 credits on the balance. A tenant with 2 credits gets one answer and then a 402. With 3 credits (3,000 tokens) and about 135 tokens per answer it gets about 8 answers before the balance drops under the 2,000-token gate. Top up from `/admin` and ask again.
7. Run `npm run cost:estimate` for the slide numbers.

The built-in `demo` tenant starts with 50 credits, which is too many to drain live. Use a fresh tenant with 2 credits for a quick out-of-credits moment (3 if you want a few answers first).

## When AstraFlow fails

A 429, a 5xx, a timeout or an empty completion from AstraFlow never reaches the visitor as an error. The Worker answers from the fact template instead, charges nothing, and logs `errorClass: wording_fallback` with the upstream class and a redacted message (ADR 0014). A model sentence that drops a price or the date is replaced by the template too (`wording_rejected`).

## Cost estimate

```bash
npm run cost:estimate
npm run cost:estimate -- --prompt 105 --completion 31 --share 0.5
npm run cost:estimate -- --prompt 130 --completion 746 --reasoning 700
```

With no flags it averages the answered rows in local D1 (`npm run db:migrate:local`, chat a few times, rerun). On a fresh clone it prints a labelled example instead. The rupiah figures use a fixed workshop rate of 16,500 per USD. Peak (2x) and off-peak columns are both shown.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Worker locally with `wrangler dev`. |
| `npm run db:migrate:local` | Apply D1 migrations to the local database. |
| `npm test` | Run the app's own vitest suite. |
| `npm run test:exercise` | Run `test/exercise/` (identity gate). Green on `main`. |
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

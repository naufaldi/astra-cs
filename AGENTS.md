# AGENTS.md

Read this before changing anything. It is for coding agents and workshop attendees opening the repo.

This is `main`, the **finished reference**. Every lab bug is fixed and `npm test`, `npm run test:exercise` and `npm run check` are green. The lab copy with eight planted bugs is the `workshop-broken` branch. Keep the two in sync: any non-bug change made here should land on `workshop-broken` too, and that branch should differ from `main` only at the bug sites and in its README/AGENTS.

## What this is

Astra CS is the Monitor Pangan support agent, a Cloudflare Worker (`monitor-pangan-support`). A visitor asks about food prices in Indonesian or English. The Worker resolves the question, reads one published price table through an in-Worker MCP tool (`https://monitor.naufaldi.com/api/pihps/fresh`), asks AstraFlow to phrase one sentence, then meters the tokens and charges the tenant in credits. One credit is 1,000 tokens at Rp100, and a tenant needs at least 2 credits to ask. `/admin` shows usage and manages tenants. It is the demo app for the AstraFlow workshop. See `README.md` for the demo script, `CONTEXT.md` for vocabulary and `docs/adr/` for decisions.

## Stack

TypeScript on Cloudflare Workers (wrangler 4), D1 for storage (`migrations/`), static chat page in `web/`, `@modelcontextprotocol/sdk`, zod, vitest, `tsc --noEmit`. Node 22.13 or newer. Tests run SQL on in-memory `node:sqlite`.

## Commands

```bash
npm install
cp .dev.vars.example .dev.vars   # then fill in the values
npm run db:migrate:local         # local D1 only
npm run dev                      # http://localhost:8787
npm test                         # vitest run
npm run check                    # tsc --noEmit
npm run cost:estimate            # monthly cost projection
```

`npm run cost:estimate` reads answered rows from local D1. With none it prints a labelled example. Flags: `--prompt N --completion N [--reasoning N] [--share 0..1]`.

Environment variable names (in `.dev.vars` locally, Worker secrets in production): `ASTRAFLOW_API_KEY`, `ASTRAFLOW_MODEL` (optional), `ASTRAFLOW_THINKING` (optional), `WORKSHOP_KEY` (optional, for `/credits` and `/handoff`). Never print or commit their values. `.dev.vars` is git-ignored.

Local `/admin` login is the seeded `admin` / `admin` (`migrations/0006_admins.sql`).

## Constraints that matter

- **Facts-only Astra payload.** The wording call gets a fixed system prompt plus the resolved facts as JSON, never the raw visitor text. Names, phones and addresses must not reach the payload, the session draft, the request log or the handoff record (`test/exercise/identity-gate.test.ts`).
- **Thinking is off by default.** The request sends `thinking: {"type":"disabled"}` unless `ASTRAFLOW_THINKING=on`. An answered call is about 135 tokens (105 prompt, 31 completion). Turning thinking on adds hundreds of reasoning tokens and seconds of latency.
- **Do not send `max_tokens`.** With this reasoning model it can return an empty reply. The payload does not set it.
- **Upstream errors fall back to the template (ADR 0014).** A 429, 5xx, timeout or empty completion gives the template answer, no charge, `wording_fallback` in the log. A model sentence that drops the price can be replaced by the template (`wording_rejected`).
- **Refusals and claims are free.** Off-topic text, trends and unpublished dates never call the model. A claimed price writes a handoff record and does not call the model.
- **The server stores only handoff records**, no transcripts or model replies (ADR 0006, 0012).
- `src/workshop/` is the credit and cost layer. `src/agent/extra-guardrail.ts` is an intentionally empty hook for adding one guardrail rule.

## Do not, unless asked

- Do not deploy (`npm run deploy`, `wrangler deploy`). `wrangler.jsonc` is the production Worker on the owner's Cloudflare account, and `wrangler.preview.jsonc` is a separate preview Worker.
- Do not rotate or change the admin password, and do not run anything against the remote D1 database.
- Do not commit or push unless asked.
- Do not change demo behavior (replies, credit prices, token gate) as a side effect of another task. Run `npm test` and `npm run check` after code changes.

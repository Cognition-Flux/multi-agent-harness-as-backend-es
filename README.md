# Vendra

**AI-adjudicated vendor/supplier onboarding & continuous compliance — a multi-agent Claude Code *harness-as-backend*.**

A vendor uploads whatever compliance documents they have (certificates of insurance, W-9s, licenses, safety records…). Each document gets its **own Claude Code agent session** running in a disposable cloud MicroVM: the agent reads the pages, classifies the document against a catalog, and extracts structured data — streamed **live** to the browser. Everything downstream is deterministic host code: validation, requirement mapping, coverage math, audit trails. A second, detached agent lane resolves **aggregate insurance coverage** (does the umbrella policy stack over the general-liability policy to clear the required limit?). A compliance officer reviews, waives, grants, and finalizes on a separate dashboard.

The model never decides compliance — it only reads documents. Humans intervene only where judgment is required.

```
                       ┌──────────────────────────── docker compose up ───────────────────────────┐
                       │                                                                          │
 Vendor browser ──SSE──►  Next.js app ── host tools ──► Claude Code agent (per document)          │
 Officer browser ─tRPC─►   │  │  │                        └── in a Vercel Sandbox MicroVM         │
                       │   │  │  └── coverage lane ─────► Claude Code agent (per vendor)          │
                       │   │  └── Postgres (own schema, Drizzle)                                  │
                       │   └── MinIO (S3-compatible document store, presigned browser uploads)    │
                       └──────────────────────────────────────────────────────────────────────────┘
```

## Quickstart (the only requirement is Docker)

```bash
git clone https://github.com/Cognition-Flux/multi-agent-harness-as-backend.git
cd multi-agent-harness-as-backend
cp .env.docker.example .env.docker
# edit .env.docker — set the FOUR remote-dependency keys:
#   ANTHROPIC_API_KEY=…   (the model)
#   VERCEL_TOKEN=…        (Vercel Sandbox — the MicroVM the agents run in)
#   VERCEL_TEAM_ID=…
#   VERCEL_PROJECT_ID=…
# and set BETTER_AUTH_SECRET to any random string (openssl rand -hex 32)
docker compose up
```

That single command brings up **five services**: `postgres` (the app's own database), `minio` (S3-compatible object storage), `minio-init` (one-shot bucket creation), `migrate` (one-shot migration apply + demo seed — **watch its log for the seeded login credentials**), and `app` (the Next.js standalone server on **http://localhost:3000**).

Everything runs locally except two **egress-only** remote dependencies: the Anthropic API and Vercel Sandbox (both are API calls out of the `app` container; nothing inbound). Without the four keys the app still boots, serves both surfaces, and accepts uploads — documents queue and `/api/health` reports `harness: unconfigured`.

### The demo walkthrough

1. Open http://localhost:3000 → sign in as the seeded **vendor contact** (credentials in the `migrate` log; `vendor@summit-demo.test` / `VendorDemo123!`).
2. Fill the business details (they drive the requirement profile — remote-only vendors skip auto/workers'-comp), then upload a COI + W-9 + license — or any PDFs/images you have. Watch each document stream live through *classify → extract → validate → map*.
3. If a document names a different business (a parent company's policy, a DBA), a **confirmation prompt** appears with a 5-minute window — answer it, or let it lapse (processing fails open and continues).
4. When the required categories are granted, hit **Activate vendor account** → `PRE_APPROVED`.
5. Sign out; sign in as the **compliance officer** (`officer@acme-demo.test` / `OfficerDemo123!`) → the `/vendors` roster → open the vendor → **Requirement Traceability** → waive / re-categorize / grant manually / retry / finalize **APPROVED**. Every action lands in the audit trail and re-folds the vendor's requirement state in the same transaction.
6. `docker compose down && docker compose up` → all state survives (named volumes).

## Architecture

One Next.js 16 app serves **both surfaces** (vendor portal + officer dashboard) plus all APIs. The interesting parts:

| Subsystem | Where | What it does |
|---|---|---|
| **Shared sandbox runtime** | `apps/vendra/src/server/harness/sandbox.ts` | ONE long-lived Vercel Sandbox MicroVM, wrapped so concurrent agent sessions each lease a bridge port (4-port pool). Proactive recreation before the 45-min lifetime cap; egress locked to `api.anthropic.com` + npm; credentials guard with named errors; warm-boot from `instrumentation.ts`. |
| **Per-document agent pipeline** | `server/harness/doc-run.ts`, `tools.ts`, `prompt.ts` | CAS-claim → storage byte verification → `HarnessAgent` session (the document bytes staged into the sandbox) → the agent calls 4 **host tools** (`saveClassification`, `saveExtraction`, `finalizeDocument`, `failDocument`). Validation/requirements/DB transitions all run host-side. 14-min budget, 2 attempts, transient recovery. |
| **SSE stream contract** | `features/vendor-compliance/lib/vendor-harness-contract.ts` | ONE file shared by routes, tools, and the React client: typed UI-message data parts (stage/extraction/validation/confirmation/terminal), zod tool schemas (⚠ never `z.record` across the harness bridge — it strips dynamic keys), upload constants. |
| **Vendor assistant chat** | `server/assistant/` + `/api/vendor/assistant` + `features/vendor-compliance/components/assistant/` | A collapsible chat drawer on the portal whose backend is the SAME harness: one Claude Code session per vendor thread, parked with `session.stop()` after every turn (a bridge port is held only while a turn streams) and resumed from Postgres. Three host tools (`getComplianceState` — page-equal numbers, `getDocumentDetails`, `rememberFacts`) plus a 40-fact long-term memory with PII redaction. Transcript/resume-state/memory live in this app's own `assistant_chat_turn` table (migration 0001); identity is cookie-implied via better-auth; 20 turns/5 min per vendor with refund-on-reject. |
| **Vendored AI Elements** | `src/components/ai-elements/` | The AI SDK's shadcn-style rendering primitives, vendored as owned source (`Tool` + the tool-part state machine, `Reasoning` auto-open/close thinking, `Task` stage checklist, Radix collapsible) — the live document cards compose them instead of hand-rolling. |
| **Live coverage progress** | `features/vendor-compliance/hooks/use-coverage-progress.ts` | An attach-only `useChat`: `resumeStream()` against the GET stream route via `prepareReconnectToStreamRequest`, transient `data-coverage-*` parts consumed in `onData` behind runtime guards; 204 → 4s retry while determining. Measured gotcha baked in: a resumed message-less stream never leaves `status: "submitted"`, so "ready" is the only safe re-attach gate. |
| **Durable HITL windows** | `server/harness/confirmations.ts` | Confirmation prompts survive page reloads and settle from any app instance: durable DB record first, 5-min window, 30s chunked tool-waits (bridge keep-alive), atomic timeout-vs-answer arbitration, fail-open expiry. |
| **Coverage-determination lane** | `server/harness/coverage-runner.ts` | A detached, per-vendor coalesced agent session resolves stacked insurance limits (primary + umbrella). Input-set signature cache (versioned — the policy-purge lever), thinking disabled (measured 17× faster on this lane), host-side payload validation that bounces bad tool calls back, fail-open UNDETERMINED record, live transient progress stream. |
| **Pure engines** | `packages/workflow/src/vendor/` | Zero-AI, zero-IO: the 17-type document catalog + extraction schemas (every field `.describe()`d — those descriptions ARE the model's extraction instructions), validators, document→category map, activation-gate math, requirement-evidence derivation, coverage validation. |
| **Recompute engine** | `server/recompute.ts` | Every terminal write / officer mutation / sweep tick funnels through one fold: manual grants read on the caller's transaction (read-your-writes), coverage categories fold **only** from the determination authority, single jsonb sibling-merge, `FOR UPDATE` row locks. |
| **Officer rescue toolkit** | `server/trpc/router.ts` | Six mutations, each on the atomicity contract: row-lock → mutate → activity row in the same tx → recompute on the same tx → latency spans logged. Waiver scopes are **server-narrowed** (a name mismatch can never waive tax identity); manual grants on coverage categories are always allowed (the determination is the authority, so the grant is the officer's only remedy). |
| **Expiry sweep** | `server/sweep.ts` | Time as a first-class trigger: hourly advisory-locked tick flips `APPROVED → EXPIRED` when a required document lapses, writes renewal notices at 30/14/1-day horizons; a valid renewal upload flips it back with no officer touch. |

### Production design rules

The load-bearing decisions are held to production discipline:

- **Disconnect semantics**: the process route's abort excludes `req.signal` — a closed tab must never kill processing; the client reconverges via a 10s snapshot poll. The no-terminal failsafe keys off the **run settling**, never the stream closing.
- **CAS everywhere a run claims or terminates** — concurrent kicks and the janitor can never double-run or overwrite a terminal state.
- **Truthfulness**: a run that didn't finish writes nothing; stale determinations render as "updating", never as fresh figures; failed documents carry real, actionable reasons.
- **PII**: full TINs and bank account numbers are never asked for, never stored, and masked again at persist time (defense in depth). Officer justification text is never logged (`noteLen` only).
- **Observability from day one**: every pipeline event is one greppable line — `[vendra:<event>] k=v k=v` — from `process.start` to `process.done`, with per-phase latency spans.

## Local development (without Docker)

Requirements: Node ≥ 22.10, pnpm 10.4.1, Docker (for postgres + minio only).

```bash
pnpm install
docker compose up -d postgres minio minio-init
# create apps/vendra/.env with the same keys as .env.docker but:
#   VENDOR_DATABASE_URL=postgresql://vendor:vendor@localhost:5436/vendra
#   S3_ENDPOINT_URL=http://localhost:9000
#   (S3_PUBLIC_ENDPOINT_URL can be omitted — it falls back to S3_ENDPOINT_URL)
pnpm --filter vendra migrate     # apply migrations + seed the demo
pnpm --filter vendra dev         # http://localhost:3000
pnpm -r type-check
```

Database schema changes: edit `packages/db-vendor/drizzle/schema.ts`, run `pnpm --filter @vendra/db-vendor generate`, commit the generated trio (SQL + journal + snapshot) together. Generated files under `drizzle/` are read-only artifacts. The container's `migrate` service only ever **applies** committed migrations.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Presigned PUT fails from the browser | `S3_PUBLIC_ENDPOINT_URL` mismatch — SigV4 signs the host, so the presigning endpoint must be the one the **browser** can reach (`http://localhost:9000` in compose). |
| `/process` returns 503 naming missing keys | The harness creds guard fired — set the four keys in `.env.docker` and `docker compose up -d app`. |
| Documents stuck PROCESSING ~20 min, then FAILED | The janitor working as designed (an orphaned run — e.g. the app restarted mid-processing). Hit "Try again". |
| Sandbox create fails (`402 payment_required`) | The Vercel team's sandbox quota — use a team-scoped token on a paid plan, or a different team. |
| Model 4xx naming the model | The Anthropic key lacks access to `HARNESS_MODEL` (enablement, not credentials). Pick a model your key can invoke. |
| Coverage stuck "determining" | Open the vendor in the officer dashboard — every officer surface kicks the determination lane on sight; the vendor portal kicks it too on its next poll. |

## Repository layout

```
apps/vendra/               the Next.js app (both surfaces + APIs + harness)
packages/workflow/         pure engines (catalog, validators, gate math) — no AI, no IO
packages/db-vendor/        the app's own Drizzle schema + committed migrations
docker-compose.yml         postgres + minio + minio-init + migrate + app
.env.docker.example        the complete env matrix, documented inline
```

## License

MIT — see [LICENSE](LICENSE).

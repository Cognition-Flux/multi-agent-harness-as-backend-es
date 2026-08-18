# Vendra — multi-stage build (SPEC §9.3).
# Two runnable targets: `runner` (the Next standalone server, distroless) and
# `migrator` (one-shot Drizzle migration apply + demo seed).
# Build context is the REPO ROOT: docker compose builds with context: .

##### BASE — node + pnpm
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
WORKDIR /app

##### DEPS — install (cached while the lockfile is unchanged)
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/vendra/package.json apps/vendra/
COPY packages/db-vendor/package.json packages/db-vendor/
COPY packages/workflow/package.json packages/workflow/
RUN pnpm install --frozen-lockfile

##### BUILDER — build the app
FROM base AS builder
COPY --from=deps /app .
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 CI=1 SKIP_ENV_VALIDATION=1
RUN pnpm --filter vendra build

##### MIGRATOR — one-shot migrations + seed (compose `migrate` service).
# tsx is a DECLARED dependency of the app; `pnpm --filter … migrate` runs it
# with cwd=apps/vendra so tsconfig paths resolve.
FROM builder AS migrator
CMD ["pnpm", "--filter", "vendra", "migrate"]

##### RUNNER — production image (distroless: no shell, nonroot uid 65532)
FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=nonroot:nonroot /app/apps/vendra/.next/standalone ./
COPY --from=builder --chown=nonroot:nonroot /app/apps/vendra/.next/static ./apps/vendra/.next/static
COPY --from=builder --chown=nonroot:nonroot /app/apps/vendra/public ./apps/vendra/public
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["apps/vendra/server.js"]

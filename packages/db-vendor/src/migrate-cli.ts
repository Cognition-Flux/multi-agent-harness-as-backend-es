/** `pnpm --filter @vendra/db-vendor migrate` — apply committed migrations. */
import { runMigrations } from "./migrate";

runMigrations().catch((err) => {
  console.error("[vendra:migrate] failed:", err);
  process.exit(1);
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  migrations: {
    table: "vendor_migrations",
  },
  dbCredentials: {
    url:
      process.env.VENDOR_DATABASE_URL ??
      "postgresql://vendor:vendor@localhost:5436/vendra",
  },
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/AppDatabaseSchema.ts",
  out: "./migrations-postgres",
  dialect: "postgresql",
});

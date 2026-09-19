import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: ["./src/database/DatabaseSchema.ts", "./src/database/AccountDatabaseSchema.ts"],
  out: "./migrations-postgres",
  dialect: "postgresql",
});

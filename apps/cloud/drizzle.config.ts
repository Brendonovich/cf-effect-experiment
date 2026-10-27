import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/database/DatabaseSchema.ts",
    "./src/database/AccountDatabaseSchema.ts",
    "./src/registry/RegistrySchema.ts",
  ],
  out: "./migrations-postgres",
  dialect: "postgresql",
});

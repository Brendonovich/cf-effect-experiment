import { persistenceContract } from "@macrograph/persistence/test-contract";
import { Layer } from "effect";
import { fileURLToPath } from "node:url";

import { DrizzleDriver, SqlitePersistence } from "../src/index.ts";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const TestLayer = SqlitePersistence.layer.pipe(
  Layer.provide(DrizzleDriver.layerNodeSqlite(":memory:", migrationsFolder)),
);

persistenceContract("SqlitePersistence contract", TestLayer);

import { NodePath } from "@effect/platform-node";
import { Layer } from "effect";

import { JsonPersistence, Persistence } from "../src/index.ts";
import { MemoryFileSystem } from "./MemoryFileSystem.ts";
import { persistenceContract } from "./PersistenceContract.ts";

persistenceContract("Persistence.layerMemory contract", Persistence.layerMemory);

persistenceContract(
  "Persistence.withMemoryBuffer(JsonPersistence) contract",
  Persistence.withMemoryBuffer(
    JsonPersistence.layer("/test-project").pipe(
      Layer.provide(Layer.mergeAll(MemoryFileSystem.layerMemory, NodePath.layer)),
    ),
  ),
);

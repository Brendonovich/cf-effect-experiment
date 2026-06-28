import { Package, PackageId, SchemaRef } from "@macrograph/core";
import { Context, Effect, Layer, Ref } from "effect";

export class Service extends Context.Service<
	Service,
	{
		readonly loadPackage: (pkg: Package.Model) => Effect.Effect<void>;
		readonly getSchema: (
			ref: SchemaRef,
		) => Effect.Effect<Package.SchemaModel, Package.SchemaNotFoundError>;
	}
>()("macrograph/Packages") { }

export const defaultLayer = Layer.effect(
	Service,
	Effect.gen(function* () {
		console.log("creating packages")
		const packages = yield* Ref.make<Map<PackageId, Package.Model>>(new Map());

		const loadPackage = Effect.fn("Packages.loadPackage")(function* (pkg: Package.Model) {
			yield* Ref.update(packages, (map) => new Map(map).set(pkg.id, pkg));
		});

		const getSchema = Effect.fn("Packages.getSchema")(function* (ref: SchemaRef) {
			const map = yield* Ref.get(packages);
			const pkg = map.get(ref.package);
			if (!pkg) {
				return yield* Effect.fail(new Package.SchemaNotFoundError({ ref }));
			}
			const schema = pkg.schemas.find((s) => s.id === ref.schema);
			if (!schema) {
				return yield* Effect.fail(new Package.SchemaNotFoundError({ ref }));
			}
			return schema;
		});

		return Service.of({ loadPackage, getSchema });
	}),
);

export * as Packages from "./Packages.ts";

import type { Manifest } from "@macrograph/module/Manifest";
import type { ModuleCatalog } from "@macrograph/module/ModuleCatalog";

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";

import type { ModuleSources } from "../src/ModuleSources.ts";

import { VersionSelection } from "../src/VersionSelection.ts";
import { official } from "./helpers.ts";

const id = official("thing");

const copy = (source: ModuleCatalog.SourceKind, version: string, api = 1): ModuleSources.Copy => {
  const manifest: Manifest.Model = {
    manifest: 1,
    publisher: "fixtures",
    name: "thing",
    version,
    api,
    displayName: "Thing",
    server: "server.cjs",
  };
  return {
    id,
    source,
    root: Option.some(`/${source}/${version}`),
    manifest,
    static: Option.none(),
  };
};

const select = (copies: ReadonlyArray<ModuleSources.Copy>, apis: ReadonlyArray<number> = [1]) =>
  VersionSelection.select({ copies, invalid: [] }, new Set(apis));

const chosen = (selection: VersionSelection.Selection) =>
  Option.map(selection.chosen, (value) => `${value.source}@${value.manifest.version}`);

describe("VersionSelection", () => {
  it("picks the highest compatible version among shipped and installed copies", () => {
    const selection = select([
      copy("shipped", "1.0.0"),
      copy("installed", "1.2.0"),
      copy("installed", "1.1.0"),
    ]);
    assert.deepStrictEqual(chosen(selection), Option.some("installed@1.2.0"));
    assert.isFalse(selection.incompatibleInstalled);
    assert.strictEqual(selection.copies.length, 3);
  });

  it("prefers the shipped copy on a version tie", () => {
    assert.deepStrictEqual(
      chosen(select([copy("installed", "1.0.0"), copy("shipped", "1.0.0")])),
      Option.some("shipped@1.0.0"),
    );
  });

  it("falls back to the shipped copy when the newer installed copy is incompatible", () => {
    const selection = select([copy("shipped", "1.0.0"), copy("installed", "2.0.0", 2)]);
    assert.deepStrictEqual(chosen(selection), Option.some("shipped@1.0.0"));
    assert.isTrue(selection.incompatibleInstalled);
    assert.deepStrictEqual(
      selection.copies.map((value) => value.compatible),
      [true, false],
    );
  });

  it("ignores incompatible installed copies older than the chosen one", () => {
    const selection = select([copy("shipped", "2.0.0"), copy("installed", "1.0.0", 0)]);
    assert.isFalse(selection.incompatibleInstalled);
  });

  it("uses the configured set of supported api versions", () => {
    assert.deepStrictEqual(
      chosen(select([copy("shipped", "1.0.0"), copy("installed", "2.0.0", 2)], [1, 2])),
      Option.some("installed@2.0.0"),
    );
    const none = select([copy("shipped", "1.0.0")], [2]);
    assert.isTrue(Option.isNone(none.chosen));
    assert.include(
      Option.getOrElse(none.error, () => ""),
      "this host supports api 2",
    );
    assert.deepStrictEqual(
      Option.map(none.manifest, (manifest) => manifest.version),
      Option.some("1.0.0"),
    );
  });

  it("lets a dev link win over every other copy, even an older one", () => {
    assert.deepStrictEqual(
      chosen(
        select([copy("shipped", "3.0.0"), copy("installed", "4.0.0"), copy("linked", "0.1.0")]),
      ),
      Option.some("linked@0.1.0"),
    );
  });

  it("fails an incompatible link instead of falling back", () => {
    const selection = select([copy("shipped", "1.0.0"), copy("linked", "1.1.0", 9)]);
    assert.isTrue(Option.isNone(selection.chosen));
    assert.include(
      Option.getOrElse(selection.error, () => ""),
      "targets api 9",
    );
  });

  it("fails a broken link instead of falling back", () => {
    const selection = VersionSelection.select(
      {
        copies: [copy("shipped", "1.0.0")],
        invalid: [{ id, source: "linked", root: "/broken", error: "Cannot read macrograph.json" }],
      },
      new Set([1]),
    );
    assert.isTrue(Option.isNone(selection.chosen));
    assert.include(
      Option.getOrElse(selection.error, () => ""),
      "/broken",
    );
  });

  it("reports unreadable copies when nothing else exists", () => {
    const selection = VersionSelection.select(
      {
        copies: [],
        invalid: [{ id, source: "installed", root: "/bad", error: "Invalid manifest" }],
      },
      new Set([1]),
    );
    assert.isTrue(Option.isNone(selection.chosen));
    assert.include(
      Option.getOrElse(selection.error, () => ""),
      "/bad: Invalid manifest",
    );
  });
});

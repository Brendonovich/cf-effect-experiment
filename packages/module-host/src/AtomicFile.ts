import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Reads a UTF-8 file, returning `undefined` if it doesn't exist. */
export const readIfExists = (path: string): string | undefined => {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  }
};

/** Writes through a temporary file and a rename, so readers never see a partial file. */
export const write = (path: string, value: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, value, { encoding: "utf8", flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // The original error is more actionable than temporary-file cleanup failure.
    }
    throw error;
  }
};

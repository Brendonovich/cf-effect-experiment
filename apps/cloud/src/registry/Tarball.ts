import { Effect, Schema } from "effect";

/**
 * Minimal gzip + ustar support for module package tarballs. Entries are paths relative to the
 * package folder (a leading `./` is ignored); only regular files and directories are accepted.
 */

export class InvalidTarball extends Schema.TaggedError<InvalidTarball>()("InvalidTarball", {
  message: Schema.String,
}) {}

export interface Limits {
  /** Maximum total size of the unpacked files, in bytes. */
  readonly maxUnpackedBytes: number;
  readonly maxFiles: number;
}

export interface Entry {
  readonly path: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

const blockSize = 512;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const streamBytes = (
  bytes: Uint8Array<ArrayBuffer>,
  transform: CompressionStream | DecompressionStream,
  limit: number,
) =>
  Effect.tryPromise({
    try: async () => {
      const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
      const chunks: Array<Uint8Array> = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          throw new Error("Tarball exceeds the unpacked size limit");
        }
        chunks.push(value);
      }
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    },
    catch: (cause) =>
      new InvalidTarball({
        message: cause instanceof Error ? cause.message : "Could not decompress the tarball",
      }),
  });

const readString = (block: Uint8Array, offset: number, length: number) => {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end));
};

const readOctal = (block: Uint8Array, offset: number, length: number) => {
  const value = readString(block, offset, length).trim();
  return value === "" ? 0 : Number.parseInt(value, 8);
};

const checksum = (header: Uint8Array) => {
  let sum = 0;
  for (let index = 0; index < blockSize; index++)
    sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
  return sum;
};

const normalizePath = (path: string) => {
  const trimmed = path.startsWith("./") ? path.slice(2) : path;
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

/** Decompresses and parses a `.tgz`, returning its regular files. */
export const read = (
  tgz: Uint8Array<ArrayBuffer>,
  limits: Limits,
): Effect.Effect<ReadonlyArray<Entry>, InvalidTarball> =>
  Effect.gen(function* () {
    // Leave room for headers and padding on top of the file contents.
    const tar = yield* streamBytes(
      tgz,
      new DecompressionStream("gzip"),
      limits.maxUnpackedBytes + (limits.maxFiles + 2) * blockSize * 2,
    );
    const entries: Array<Entry> = [];
    let offset = 0;
    let fileBytes = 0;
    let longName: string | undefined;
    let paxPath: string | undefined;
    const fail = (message: string) => Effect.fail(new InvalidTarball({ message }));

    while (offset + blockSize <= tar.byteLength) {
      const header = tar.subarray(offset, offset + blockSize);
      if (header.every((byte) => byte === 0)) break;
      if (readOctal(header, 148, 8) !== checksum(header))
        return yield* fail("Tarball header checksum mismatch");

      const size = readOctal(header, 124, 12);
      const type = String.fromCharCode(header[156] ?? 0);
      const dataStart = offset + blockSize;
      const dataEnd = dataStart + size;
      if (dataEnd > tar.byteLength) return yield* fail("Tarball is truncated");
      const data = tar.slice(dataStart, dataEnd);
      offset = dataStart + Math.ceil(size / blockSize) * blockSize;

      if (type === "L") {
        longName = readString(data, 0, data.byteLength);
        continue;
      }
      if (type === "x") {
        for (const record of decoder.decode(data).split("\n")) {
          const match = /^\d+ path=(.*)$/.exec(record);
          if (match?.[1] !== undefined) paxPath = match[1];
        }
        continue;
      }
      if (type === "g") continue;

      const prefix = readString(header, 345, 155);
      const name = readString(header, 0, 100);
      const path = normalizePath(
        paxPath ?? longName ?? (prefix === "" ? name : `${prefix}/${name}`),
      );
      longName = undefined;
      paxPath = undefined;

      if (type === "5") continue;
      if (type !== "0" && type !== "\0")
        return yield* fail(`Unsupported tarball entry type for ${path}`);
      if (entries.length >= limits.maxFiles)
        return yield* fail(`Tarball has more than ${limits.maxFiles} files`);
      fileBytes += size;
      if (fileBytes > limits.maxUnpackedBytes)
        return yield* fail("Tarball exceeds the unpacked size limit");
      entries.push({ path, bytes: data });
    }
    return entries;
  });

const writeString = (header: Uint8Array, offset: number, length: number, value: string) => {
  header.set(encoder.encode(value).subarray(0, length), offset);
};

const writeOctal = (header: Uint8Array, offset: number, length: number, value: number) => {
  writeString(header, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
};

/** Builds a `.tgz` of regular files. Paths must fit in a ustar header (≤ 100 bytes). */
export const write = (
  files: ReadonlyArray<{ readonly path: string; readonly content: string | Uint8Array }>,
): Effect.Effect<Uint8Array<ArrayBuffer>, InvalidTarball> => {
  const blocks: Array<Uint8Array> = [];
  for (const file of files) {
    const content = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    const header = new Uint8Array(blockSize);
    writeString(header, 0, 100, file.path);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, content.byteLength);
    writeOctal(header, 136, 12, 0);
    header[156] = "0".charCodeAt(0);
    writeString(header, 257, 6, "ustar\0");
    writeString(header, 263, 2, "00");
    writeOctal(header, 148, 8, checksum(header));
    blocks.push(
      header,
      content,
      new Uint8Array((blockSize - (content.byteLength % blockSize)) % blockSize),
    );
  }
  blocks.push(new Uint8Array(blockSize * 2));
  const tar = new Uint8Array(blocks.reduce((total, block) => total + block.byteLength, 0));
  let offset = 0;
  for (const block of blocks) {
    tar.set(block, offset);
    offset += block.byteLength;
  }
  return streamBytes(tar, new CompressionStream("gzip"), Number.POSITIVE_INFINITY);
};

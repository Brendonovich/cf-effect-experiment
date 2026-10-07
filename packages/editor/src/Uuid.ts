const hex = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"));

// crypto.randomUUID is limited to secure contexts, but getRandomValues is not.
export const randomUUID = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, (byte) => hex[byte]!);
  return `${h.slice(0, 4).join("")}-${h.slice(4, 6).join("")}-${h.slice(6, 8).join("")}-${h.slice(8, 10).join("")}-${h.slice(10).join("")}`;
};

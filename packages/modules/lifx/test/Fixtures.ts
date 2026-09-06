import { Buffer } from "node:buffer";

import { DeviceId, type Device } from "../src/Definition.ts";

export const device: Device = {
  id: DeviceId.make("d0:73:d5:12:34:56"),
  name: "Desk",
  address: "192.168.1.50",
  port: 56700,
};

export function statePayload() {
  const payload = Buffer.alloc(52);
  payload.writeUInt16LE(12345, 0);
  payload.writeUInt16LE(23456, 2);
  payload.writeUInt16LE(34567, 4);
  payload.writeUInt16LE(3500, 6);
  payload.writeUInt16LE(65535, 10);
  payload.write("Desk", 12);
  return payload;
}

// Independent response fixture: do not use the production packet encoder.
export function response(request: Buffer, type = 107, payload = statePayload()) {
  const packet = Buffer.alloc(36 + payload.length);
  packet.writeUInt16LE(packet.length, 0);
  packet.writeUInt16LE(0x1400, 2);
  request.copy(packet, 4, 4, 16);
  packet[23] = request[23]!;
  packet.writeUInt16LE(type, 32);
  payload.copy(packet, 36);
  return packet;
}

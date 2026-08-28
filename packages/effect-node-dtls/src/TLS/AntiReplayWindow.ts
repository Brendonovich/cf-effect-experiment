// Port of TLS/AntiReplayWindow.ts from node-dtls-client 2.0.3.
// Copyright (c) 2017-2026 AlCalzone <d.griesel@gmx.net> (MIT); see LICENSE.
export const MAX_SEQUENCE = 2 ** 48 - 1;

/** 64-record sliding bitmap. Call markAsReceived only AFTER authentication. */
export class AntiReplayWindow {
  private ceiling = -1;
  private bitmap = 0n;

  reset(): void {
    this.ceiling = -1;
    this.bitmap = 0n;
  }

  mayReceive(sequence: number): boolean {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > MAX_SEQUENCE) return false;
    if (sequence > this.ceiling) return true;
    const age = this.ceiling - sequence;
    return age < 64 && (this.bitmap & (1n << BigInt(age))) === 0n;
  }

  markAsReceived(sequence: number): void {
    if (!this.mayReceive(sequence)) throw new Error("Invalid replay-window update");
    if (sequence > this.ceiling) {
      const shift = sequence - this.ceiling;
      // Bound the shift before converting to BigInt; huge authenticated gaps are valid.
      this.bitmap = shift >= 64 ? 0n : (this.bitmap << BigInt(shift)) & ((1n << 64n) - 1n);
      this.ceiling = sequence;
    }
    this.bitmap |= 1n << BigInt(this.ceiling - sequence);
  }
}

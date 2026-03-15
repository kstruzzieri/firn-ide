import type { OutputEntry } from '../types/runOutput';

type EmitFn = (entry: OutputEntry) => void;

/**
 * Normalizes arbitrary byte chunks into line-oriented OutputEntry values.
 * Maintains per-stream carry-over for partial lines across chunks.
 */
export class LineAssembler {
  private carry: Record<string, { data: string; timestamp: number }> = {};
  private emit: EmitFn;

  constructor(emit: EmitFn) {
    this.emit = emit;
  }

  push(stream: 'stdout' | 'stderr', data: string, timestamp: number): void {
    if (data.length === 0) return;

    const carried = this.carry[stream];
    const combined = carried ? carried.data + data : data;
    const carriedTimestamp = carried ? carried.timestamp : timestamp;

    const parts = combined.split('\n');

    for (let i = 0; i < parts.length - 1; i++) {
      const text = parts[i].endsWith('\r') ? parts[i].slice(0, -1) : parts[i];
      this.emit({
        stream,
        text,
        timestamp: i === 0 ? carriedTimestamp : timestamp,
      });
    }

    const lastPart = parts[parts.length - 1];
    if (lastPart.length > 0) {
      this.carry[stream] = {
        data: lastPart,
        timestamp: parts.length === 1 ? carriedTimestamp : timestamp,
      };
    } else {
      delete this.carry[stream];
    }
  }

  flush(): void {
    for (const stream of Object.keys(this.carry) as Array<'stdout' | 'stderr'>) {
      const carried = this.carry[stream];
      if (carried && carried.data.length > 0) {
        this.emit({
          stream,
          text: carried.data,
          timestamp: carried.timestamp,
        });
      }
    }
    this.carry = {};
  }
}

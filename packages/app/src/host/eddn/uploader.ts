import { gzipSync } from 'node:zlib';
import type { EddnEnvelope } from './builders.js';
import type { EddnBroadcast } from '../../shared/ipc-types.js';

const DEFAULT_GATEWAY = 'https://eddn.edcd.io:4430/upload/';
const MAX_QUEUE = 50;
const DEFAULT_RETRY_DELAYS_MS = [1000, 5000, 15000];

export interface EddnUploaderOptions {
  /** POST a gzipped body; returns the HTTP status. Default posts to the real gateway. */
  post?: (body: Buffer) => Promise<{ status: number }>;
  retryDelaysMs?: number[];
  gatewayUrl?: string;
}

export class EddnUploader {
  private queue: EddnEnvelope[] = [];
  private working: Promise<void> = Promise.resolve();
  private _enabled = true;
  private _counters = { sent: 0, dropped: 0 };
  private listeners: Array<(c: EddnBroadcast) => void> = [];
  private readonly post: (body: Buffer) => Promise<{ status: number }>;
  private readonly retryDelays: number[];

  constructor(opts: EddnUploaderOptions = {}) {
    const gateway = opts.gatewayUrl ?? process.env.EDDN_UPLOAD_URL ?? DEFAULT_GATEWAY;
    this.post =
      opts.post ??
      (async (body: Buffer) => {
        const res = await fetch(gateway, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip' },
          body,
        });
        return { status: res.status };
      });
    this.retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get counters(): EddnBroadcast {
    return { enabled: this._enabled, sent: this._counters.sent, dropped: this._counters.dropped, queued: this.queue.length };
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    if (!enabled) this.queue = [];
    this.notify();
  }

  onChange(cb: (c: EddnBroadcast) => void): void {
    this.listeners.push(cb);
  }

  private notify(): void {
    const snapshot = this.counters;
    for (const cb of this.listeners) cb(snapshot);
  }

  enqueue(env: EddnEnvelope): void {
    if (!this._enabled) return;
    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift();
      this._counters.dropped++;
    }
    this.queue.push(env);
    this.notify();
    this.working = this.working.then(() => this.pump());
  }

  /** Awaitable in tests: resolves when the queue has been fully processed. */
  async drain(): Promise<void> {
    await this.working;
  }

  private async pump(): Promise<void> {
    while (this.queue.length > 0) {
      const env = this.queue.shift()!;
      const body = gzipSync(JSON.stringify(env));
      let outcome: 'sent' | 'dropped' = 'dropped';
      for (let attempt = 0; attempt < this.retryDelays.length; attempt++) {
        let status = 0;
        try {
          status = (await this.post(body)).status;
        } catch {
          status = 0; // network error — treat as transient
        }
        if (status >= 200 && status < 300) {
          outcome = 'sent';
          break;
        }
        if (status >= 400 && status < 500) {
          // Schema rejection — never retry; surface for diagnosis.
          console.error(`[eddn] gateway rejected message (HTTP ${status}) for ${env.$schemaRef}`);
          break;
        }
        if (attempt < this.retryDelays.length - 1) {
          await new Promise((r) => setTimeout(r, this.retryDelays[attempt]));
        }
      }
      this._counters[outcome]++;
      this.notify();
    }
  }
}

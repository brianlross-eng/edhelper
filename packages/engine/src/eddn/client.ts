import { EventEmitter } from 'node:events';
import { inflateSync } from 'node:zlib';
import * as zmq from 'zeromq';
import type { EddnCommodityMessage } from './apply.js';

const EDDN_RELAY = 'tcp://eddn.edcd.io:9500';
const COMMODITY_SCHEMA = 'https://eddn.edcd.io/schemas/commodity/3';
const HEARTBEAT_MS = 120_000; // relay sends constant traffic; silence means a dead socket

/**
 * Emits:
 *  - 'commodity' (msg: EddnCommodityMessage)
 *  - 'status' ('connected' | 'reconnecting' | 'stopped')
 */
export class EddnClient extends EventEmitter {
  private sock: zmq.Subscriber | null = null;
  private running = false;
  private lastMessageAt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.heartbeatTimer = setInterval(() => {
      if (this.running && Date.now() - this.lastMessageAt > HEARTBEAT_MS) {
        this.emit('status', 'reconnecting');
        this.restart();
      }
    }, HEARTBEAT_MS);
    this.heartbeatTimer.unref?.();
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.sock?.close();
    this.sock = null;
    this.emit('status', 'stopped');
  }

  private restart(): void {
    this.sock?.close();
    this.sock = null;
    if (this.running) this.connect();
  }

  private connect(): void {
    const sock = new zmq.Subscriber();
    sock.connect(EDDN_RELAY);
    sock.subscribe('');
    this.sock = sock;
    this.lastMessageAt = Date.now();
    this.emit('status', 'connected');
    void this.pump(sock);
  }

  private async pump(sock: zmq.Subscriber): Promise<void> {
    try {
      for await (const [frame] of sock) {
        this.lastMessageAt = Date.now();
        let envelope: any;
        try {
          envelope = JSON.parse(inflateSync(frame).toString('utf8'));
        } catch {
          continue;
        }
        if (envelope.$schemaRef !== COMMODITY_SCHEMA) continue;
        const m = envelope.message;
        if (!m || typeof m.marketId !== 'number') continue;
        const msg: EddnCommodityMessage = {
          marketId: m.marketId,
          systemName: m.systemName ?? '',
          stationName: m.stationName ?? '',
          timestamp: m.timestamp ?? new Date().toISOString(),
          commodities: (m.commodities ?? []).map((c: any) => ({
            name: c.name ?? '',
            buyPrice: c.buyPrice ?? 0,
            sellPrice: c.sellPrice ?? 0,
            stock: c.stock ?? 0,
            demand: c.demand ?? 0,
          })),
        };
        this.emit('commodity', msg);
      }
    } catch {
      // Genuine transport error — intentional close() resolves the iterator instead of throwing.
      if (this.running && this.sock === sock) {
        this.emit('status', 'reconnecting');
        this.restart();
      }
    }
  }
}

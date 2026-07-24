import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { LineCodec, encodeLine, decodeLine } from '../host/rpc.js';
import type { RpcMessage } from '../shared/ipc-types.js';

export interface EngineClientSpawnSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Spawns the engine-host child process and provides typed promise RPC over stdio.
 * Emits 'event:<name>' for pushed events (e.g. 'event:eddn') and restarts the
 * child with a 2s delay if it exits unexpectedly. A received 'fatal' event
 * (an unexpected startup failure in the host) suppresses auto-restart so a
 * persistently bad config doesn't loop silently; call start() again to retry.
 */
export class EngineClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private disposed = false;
  private lastFatal: string | null = null;

  constructor(private readonly spawnSpec: EngineClientSpawnSpec) {
    super();
  }

  get fatalError(): string | null {
    return this.lastFatal;
  }

  start(): void {
    if (this.disposed || this.child) return;
    this.lastFatal = null;
    const child = spawn(this.spawnSpec.command, this.spawnSpec.args, {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...this.spawnSpec.env },
    });
    const codec = new LineCodec();
    child.stdout!.on('data', (chunk) => {
      for (const line of codec.push(chunk)) {
        const msg = decodeLine<RpcMessage>(line);
        if (!msg) continue;
        if ('event' in msg) {
          if (msg.event === 'fatal') {
            this.lastFatal = String((msg.data as any)?.error ?? 'engine host failed');
          }
          this.emit(`event:${msg.event}`, msg.data);
          continue;
        }
        const p = this.pending.get(msg.id);
        if (!p) continue;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error));
      }
    });
    child.on('close', () => {
      this.child = null;
      for (const p of this.pending.values()) p.reject(new Error('engine host exited'));
      this.pending.clear();
      if (!this.disposed && this.lastFatal === null) setTimeout(() => this.start(), 2000).unref?.();
    });
    this.child = child;
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 120_000): Promise<T> {
    const child = this.child;
    if (!child?.stdin) return Promise.reject(new Error('engine host not running'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.stdin!.write(encodeLine({ id, method, params }));
    });
  }

  dispose(): void {
    this.disposed = true;
    this.child?.kill();
    this.child = null;
    for (const p of this.pending.values()) p.reject(new Error('engine client disposed'));
    this.pending.clear();
  }
}

import { describe, it, expect, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { EddnUploader } from '../src/host/eddn/uploader';

const ENVELOPE = {
  $schemaRef: 'https://eddn.edcd.io/schemas/journal/1',
  header: { uploaderID: 'X', softwareName: 'EDHelper', softwareVersion: '0.1.0' },
  message: { event: 'FSDJump', StarSystem: 'Sol' },
};

function makeUploader(post: (body: Buffer) => Promise<{ status: number }>) {
  return new EddnUploader({ post, retryDelaysMs: [1, 1, 1] });
}

describe('EddnUploader', () => {
  it('gzips and posts queued envelopes, counting sent', async () => {
    const bodies: Buffer[] = [];
    const up = makeUploader(async (b) => {
      bodies.push(b);
      return { status: 200 };
    });
    up.enqueue(ENVELOPE);
    await up.drain();
    expect(up.counters.sent).toBe(1);
    expect(JSON.parse(gunzipSync(bodies[0]).toString('utf8')).message.event).toBe('FSDJump');
  });

  it('drops schema rejections (4xx) without retrying', async () => {
    const post = vi.fn(async () => ({ status: 400 }));
    const up = makeUploader(post);
    up.enqueue(ENVELOPE);
    await up.drain();
    expect(post).toHaveBeenCalledTimes(1);
    expect(up.counters.dropped).toBe(1);
    expect(up.counters.sent).toBe(0);
  });

  it('retries transient failures then drops', async () => {
    const post = vi.fn(async () => ({ status: 503 }));
    const up = makeUploader(post);
    up.enqueue(ENVELOPE);
    await up.drain();
    expect(post).toHaveBeenCalledTimes(3);
    expect(up.counters.dropped).toBe(1);
  });

  it('recovers when a retry succeeds', async () => {
    let n = 0;
    const up = makeUploader(async () => ({ status: ++n < 2 ? 503 : 200 }));
    up.enqueue(ENVELOPE);
    await up.drain();
    expect(up.counters.sent).toBe(1);
    expect(up.counters.dropped).toBe(0);
  });

  it('discards immediately when disabled', async () => {
    const post = vi.fn(async () => ({ status: 200 }));
    const up = makeUploader(post);
    up.setEnabled(false);
    up.enqueue(ENVELOPE);
    await up.drain();
    expect(post).not.toHaveBeenCalled();
    expect(up.counters.sent).toBe(0);
    expect(up.enabled).toBe(false);
  });

  it('notifies on counter changes', async () => {
    const updates: any[] = [];
    const up = makeUploader(async () => ({ status: 200 }));
    up.onChange((c) => updates.push(c));
    up.enqueue(ENVELOPE);
    await up.drain();
    expect(updates.at(-1).sent).toBe(1);
  });
});

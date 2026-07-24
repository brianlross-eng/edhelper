import { describe, it, expect } from 'vitest';
import { LineCodec, encodeLine, decodeLine } from '../src/host/rpc';

describe('LineCodec', () => {
  it('reassembles lines across partial chunks', () => {
    const codec = new LineCodec();
    expect(codec.push('{"id":1,"ok":tr')).toEqual([]);
    expect(codec.push('ue,"result":5}\n{"id":2,')).toEqual(['{"id":1,"ok":true,"result":5}']);
    expect(codec.push('"ok":false,"error":"x"}\n')).toEqual(['{"id":2,"ok":false,"error":"x"}']);
  });

  it('handles multiple lines in one chunk and skips blanks', () => {
    const codec = new LineCodec();
    expect(codec.push('{"a":1}\n\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('encodes and decodes round-trip, returning null for junk', () => {
    const line = encodeLine({ id: 7, method: 'ping' });
    expect(line.endsWith('\n')).toBe(true);
    expect(decodeLine(line.trim())).toEqual({ id: 7, method: 'ping' });
    expect(decodeLine('not json')).toBeNull();
  });
});

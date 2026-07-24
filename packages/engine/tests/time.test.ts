import { describe, it, expect } from 'vitest';
import { toSqliteUtc } from '../src/time.js';

describe('toSqliteUtc', () => {
  it('normalizes spansh and EDDN formats to sqlite utc', () => {
    expect(toSqliteUtc('2026-07-01 12:00:00+00')).toBe('2026-07-01 12:00:00');
    expect(toSqliteUtc('2026-07-23T02:00:00Z')).toBe('2026-07-23 02:00:00');
    expect(toSqliteUtc('2026-07-23T02:00:00+02:00')).toBe('2026-07-23 00:00:00');
    expect(toSqliteUtc('garbage')).toBeNull();
    expect(toSqliteUtc(null)).toBeNull();
    expect(toSqliteUtc(undefined)).toBeNull();
  });
});

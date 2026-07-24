import { describe, it, expect } from 'vitest';
import { openDatabase } from '../src/db.js';
import { insertSystem, systemsWithinRadius } from '../src/spatial.js';

describe('systemsWithinRadius', () => {
  it('returns systems inside the radius with exact distance filtering', () => {
    const db = openDatabase(':memory:');
    insertSystem(db, { id64: '1', name: 'Origin', x: 0, y: 0, z: 0 });
    insertSystem(db, { id64: '2', name: 'Near', x: 10, y: 0, z: 0 });
    // Inside the 15-ly bounding box but 17.3 ly away — must be excluded:
    insertSystem(db, { id64: '3', name: 'Corner', x: 10, y: 10, z: 10 });
    insertSystem(db, { id64: '4', name: 'Far', x: 200, y: 0, z: 0 });

    const hits = systemsWithinRadius(db, 0, 0, 0, 15);
    const names = hits.map((h) => h.name).sort();
    expect(names).toEqual(['Near', 'Origin']);
    const near = hits.find((h) => h.name === 'Near')!;
    expect(near.distance).toBeCloseTo(10, 5);
    db.close();
  });

  it('handles duplicate id64 consistently with INSERT OR IGNORE', () => {
    const db = openDatabase(':memory:');
    // Insert first system with id64 '5' at coordinates (5, 5, 5)
    const id1 = insertSystem(db, { id64: '5', name: 'First', x: 5, y: 5, z: 5 });
    // Attempt to insert same id64 '5' at different coordinates (20, 20, 20)
    const id2 = insertSystem(db, { id64: '5', name: 'Second', x: 20, y: 20, z: 20 });

    // Both calls return the same internal id
    expect(id1).toBe(id2);

    // systems_rtree contains exactly ONE row for this id
    const rtreeCount = (
      db.prepare('SELECT COUNT(*) AS n FROM systems_rtree WHERE id = ?').get(id1) as any
    ).n;
    expect(rtreeCount).toBe(1);

    // systemsWithinRadius around the original coordinates returns exactly one hit
    // with the ORIGINAL coordinates (INSERT OR IGNORE keeps the first insert)
    const hits = systemsWithinRadius(db, 5, 5, 5, 1);
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('First');
    expect(hits[0].x).toBe(5);
    expect(hits[0].y).toBe(5);
    expect(hits[0].z).toBe(5);

    // Query around the second coordinates should return nothing (not stored)
    const hitsAround20 = systemsWithinRadius(db, 20, 20, 20, 1);
    expect(hitsAround20).toHaveLength(0);

    db.close();
  });

  it('r-tree epsilon handles float32 precision at galaxy-edge scale', () => {
    const db = openDatabase(':memory:');
    // Insert a system at galaxy-edge magnitude
    insertSystem(db, { id64: '9', name: 'Edge', x: 40000.1234, y: 0, z: 0 });

    // Query centered exactly on it with a tiny radius (0.001 ly)
    // At x≈40000 the float32 r-tree box rounds by up to ~0.004 ly,
    // so this test would fail if RTREE_EPS padding (0.01) is removed.
    const hits = systemsWithinRadius(db, 40000.1234, 0, 0, 0.001);

    // Should find the 'Edge' system
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe('Edge');
    expect(hits[0].distance).toBeCloseTo(0, 5);

    db.close();
  });
});

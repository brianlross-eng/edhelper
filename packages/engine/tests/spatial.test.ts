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
});

import { describe, expect, it } from 'vitest';

import { deepFreeze } from './deep-freeze';

describe('deepFreeze', () => {
  it('recursively freezes plain objects and arrays while preserving root identity', () => {
    const input = {
      rows: [
        { id: 'row-1', values: ['1', '2'] },
        { id: 'row-2', values: ['3'] },
      ],
      metadata: {
        source: { id: 'source-1', verified: true },
        tags: ['model', 'analysis'],
      },
    };

    const result = deepFreeze(input);

    expect(result).toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rows)).toBe(true);
    expect(Object.isFrozen(result.rows[0])).toBe(true);
    expect(Object.isFrozen(result.rows[0]?.values)).toBe(true);
    expect(Object.isFrozen(result.metadata)).toBe(true);
    expect(Object.isFrozen(result.metadata.source)).toBe(true);
    expect(Object.isFrozen(result.metadata.tags)).toBe(true);
  });
});

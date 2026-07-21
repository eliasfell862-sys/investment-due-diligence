import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('runs in jsdom', () => {
    expect(window.document).toBeDefined();
  });
});

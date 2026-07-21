import { describe, expect, it } from 'vitest';

describe('test harness', () => {
  it('loads jest-dom matchers', () => {
    expect(window.document.body).toBeInTheDocument();
  });

  it('loads fake IndexedDB', () => {
    expect(globalThis.indexedDB).toBeDefined();
  });
});

import { expect, it } from 'vitest';
import { WATCHLIST_ADVICE_CACHE_KEY } from './watchlist-buy-advice-service';

it('uses a new advice cache version after adding the coal cyclical PE factor', () => {
  expect(WATCHLIST_ADVICE_CACHE_KEY).toBe('sec_watchlist_buy_advice_cache_v2');
});

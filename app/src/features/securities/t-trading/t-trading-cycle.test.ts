import { describe, expect, it } from 'vitest';
import {
  applyTTradeBuyback,
  expireTTradeCycle,
  keepTTradeAsReduction,
  openTTradeCycle,
  pauseTTradeBuyback,
} from './t-trading-cycle';

function openedCycle() {
  return openTTradeCycle({
    id: 'cycle-1',
    positionId: 'position-1',
    code: '000685',
    cycleType: 'profit_t',
    preCycleAverageCost: 11.1,
    preCycleTotalShares: 1_000,
    sellExecution: {
      id: 'execution-sell',
      idempotencyKey: 'sell-1',
      side: 'sell',
      price: 12,
      shares: 300,
      totalFees: 6,
      executedAt: '2026-08-11T02:00:00.000Z',
    },
  });
}

describe('T-trading cycle state machine', () => {
  it('allocates sell fees proportionally for a partial buyback', () => {
    const opened = openedCycle();
    const partial = applyTTradeBuyback(opened, {
      id: 'execution-buy-1',
      idempotencyKey: 'buy-1',
      side: 'buyback',
      price: 11,
      shares: 100,
      totalFees: 5,
      executedAt: '2026-08-11T03:00:00.000Z',
    });

    expect(opened.remainingBuybackShares).toBe(300);
    expect(partial.status).toBe('partially_bought_back');
    expect(partial.remainingBuybackShares).toBe(200);
    expect(partial.realizedTProfit).toBe(93);
    expect(partial.executions).toHaveLength(2);
  });

  it('completes the cycle and calculates restored-position cost improvement', () => {
    const partial = applyTTradeBuyback(openedCycle(), {
      id: 'execution-buy-1',
      idempotencyKey: 'buy-1',
      side: 'buyback',
      price: 11,
      shares: 100,
      totalFees: 5,
      executedAt: '2026-08-11T03:00:00.000Z',
    });
    const completed = applyTTradeBuyback(partial, {
      id: 'execution-buy-2',
      idempotencyKey: 'buy-2',
      side: 'buyback',
      price: 11,
      shares: 200,
      totalFees: 5,
      executedAt: '2026-08-11T04:00:00.000Z',
    });

    expect(completed.status).toBe('completed');
    expect(completed.remainingBuybackShares).toBe(0);
    expect(completed.realizedTProfit).toBe(284);
    expect(completed.costReductionPerShare).toBeCloseTo(0.284, 8);
    expect(completed.adjustedAverageCost).toBeCloseTo(10.816, 8);
    expect(partial.executions).toHaveLength(2);
    expect(completed.executions).toHaveLength(3);
  });

  it('supports risk pause, expiry and conversion of unmatched shares to reduction', () => {
    const paused = pauseTTradeBuyback(openedCycle(), ['support_break']);
    expect(paused.status).toBe('buyback_paused_risk_review');

    const expired = expireTTradeCycle(openedCycle());
    expect(expired.status).toBe('expired_unfilled');
    expect(expired.monitoringEnabled).toBe(false);

    const partial = applyTTradeBuyback(openedCycle(), {
      id: 'execution-buy-1',
      idempotencyKey: 'buy-1',
      side: 'buyback',
      price: 11,
      shares: 100,
      totalFees: 5,
      executedAt: '2026-08-11T03:00:00.000Z',
    });
    const reduction = keepTTradeAsReduction(partial);
    expect(reduction.status).toBe('kept_as_reduction');
    expect(reduction.keptAsReductionShares).toBe(200);
    expect(reduction.realizedTProfit).toBe(93);
    expect(reduction.monitoringEnabled).toBe(false);
  });

  it('rejects duplicate idempotency keys and over-buybacks', () => {
    expect(() => applyTTradeBuyback(openedCycle(), {
      id: 'execution-duplicate',
      idempotencyKey: 'sell-1',
      side: 'buyback',
      price: 11,
      shares: 100,
      totalFees: 5,
      executedAt: '2026-08-11T03:00:00.000Z',
    })).toThrow(/idempotency/i);

    expect(() => applyTTradeBuyback(openedCycle(), {
      id: 'execution-over',
      idempotencyKey: 'buy-over',
      side: 'buyback',
      price: 11,
      shares: 400,
      totalFees: 5,
      executedAt: '2026-08-11T03:00:00.000Z',
    })).toThrow(/remaining/i);
  });
});

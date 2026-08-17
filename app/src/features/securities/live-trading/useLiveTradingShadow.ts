import { useCallback, useEffect, useMemo, useState } from 'react';
import { aggregateAllWatchlistCandidates } from '../all-watchlists-portfolio-candidates';
import { useOptionalSecuritiesState } from '../state/securities-state-context';
import { DEFAULT_TRADING_FEE_PROFILE } from '../t-trading/trading-fee-engine';
import { useRealtimeStockQuotes } from '../useRealtimeStockQuotes';
import { scanLiveTradingCandidates } from './live-trading-candidate-scanner';
import { SHADOW_LIVE_TRADING_PROFILE } from './live-trading-profile';
import { planLiveBuy } from './live-trading-risk-engine';
import { evaluateLiveTradingSignal } from './live-trading-signal-policy';
import { createShadowTradingStore } from './shadow-trading-store';
import { evaluateShadowQualification, type ShadowQualificationOrder } from './shadow-qualification';
import type { BridgeCapabilityReport, EastmoneyOcrAccountSnapshot, LiveTradingCandidate } from './live-trading-types';

type BridgeStatus = { state: 'stopped' | 'starting' | 'ready' | 'failed'; port: number; lastError: string | null };

const offlineStatus: BridgeStatus = { state: 'failed', port: 8765, lastError: 'electron_bridge_unavailable' };

function localWatchlistCodes(): string[] {
  if (typeof localStorage === 'undefined') return [];
  return aggregateAllWatchlistCandidates(localStorage).candidates.map(item => item.code);
}

export function useLiveTradingShadow() {
  const securitiesState = useOptionalSecuritiesState();
  const accountId = securitiesState?.userId || 'local-device';
  const [accountDraft, setAccountDraft] = useState<EastmoneyOcrAccountSnapshot | null>(null);
  const [confirmedAccount, setConfirmedAccount] = useState<EastmoneyOcrAccountSnapshot | null>(null);
  const [accountReading, setAccountReading] = useState(false);
  const [accountError, setAccountError] = useState('');
  const watchlistCodes = useMemo(() => {
    const source = securitiesState
      ? securitiesState.watchlists.data.flatMap(watchlist => watchlist.codes)
      : localWatchlistCodes();
    return [...new Set(source.filter(code => /^\d{6}$/.test(code)))].sort();
  }, [securitiesState, securitiesState?.watchlists.data]);
  const marketCodes = useMemo(() => [...new Set([
    ...watchlistCodes,
    ...(confirmedAccount?.positions.map(position => position.code) ?? []),
  ])].sort(), [confirmedAccount, watchlistCodes]);
  const realtime = useRealtimeStockQuotes(marketCodes);
  const store = useMemo(() => createShadowTradingStore(localStorage, accountId), [accountId]);
  const initialSnapshot = store.snapshot();
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>(offlineStatus);
  const [probeReport, setProbeReport] = useState<BridgeCapabilityReport | null>(null);
  const [candidates, setCandidates] = useState<LiveTradingCandidate[]>([]);
  const [orders, setOrders] = useState<ShadowQualificationOrder[]>(initialSnapshot.orders as ShadowQualificationOrder[]);
  const [reservedTBuybackCash, setReservedTBuybackCash] = useState(initialSnapshot.reservedTBuybackCash);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!window.electronTrading) {
      setBridgeStatus(offlineStatus);
      return undefined;
    }
    void window.electronTrading.getStatus().then(status => {
      if (active) setBridgeStatus(status);
    }).catch(() => {
      if (active) setBridgeStatus(offlineStatus);
    });
    return () => { active = false; };
  }, []);

  const scanCandidates = useCallback(async () => {
    setAnalyzing(true);
    setError('');
    try {
      await realtime.refreshNow();
      const result = await scanLiveTradingCandidates({
        accountId,
        codes: watchlistCodes,
        quotes: realtime.quotes,
        force: true,
      });
      setCandidates(result);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'candidate_scan_failed');
    } finally {
      setAnalyzing(false);
    }
  }, [accountId, realtime, watchlistCodes]);

  const runProbe = useCallback(async () => {
    if (!window.electronTrading) throw new Error('trading_bridge_offline');
    const result = await window.electronTrading.runEastmoneyProbe() as BridgeCapabilityReport;
    setProbeReport(result);
  }, []);

  const readEastmoneyAccount = useCallback(async () => {
    if (!window.electronTrading || bridgeStatus.state !== 'ready') {
      throw new Error('trading_bridge_offline');
    }
    setAccountReading(true);
    setAccountError('');
    setAccountDraft(null);
    setConfirmedAccount(null);
    try {
      const result = await window.electronTrading.readEastmoneyAccount();
      if (!result.available) {
        setAccountError(result.failureReason || 'account_snapshot_unavailable');
        return;
      }
      setAccountDraft(result);
    } catch (readError) {
      setAccountError(readError instanceof Error ? readError.message : 'account_snapshot_failed');
    } finally {
      setAccountReading(false);
    }
  }, [bridgeStatus.state]);

  const confirmEastmoneyAccount = useCallback(() => {
    if (!accountDraft?.available) throw new Error('account_snapshot_not_ready');
    setConfirmedAccount(accountDraft);
  }, [accountDraft]);

  const clearEastmoneyAccount = useCallback(() => {
    setAccountDraft(null);
    setConfirmedAccount(null);
    setAccountError('');
  }, []);

  const submitCandidate = useCallback(async (candidate: LiveTradingCandidate) => {
    if (!window.electronTrading || bridgeStatus.state !== 'ready') throw new Error('trading_bridge_offline');
    const signal = evaluateLiveTradingSignal({
      price: candidate.price,
      shortAction: candidate.shortAdvice.action,
      mediumAction: candidate.mediumAdvice.action,
      shortEntryRange: candidate.shortAdvice.entryRange
        ? { low: candidate.shortAdvice.entryRange.low, high: candidate.shortAdvice.entryRange.high }
        : null,
      formalBuyPrice: candidate.formalTargets.buyPrice,
      dataFresh: candidate.dataFresh,
      formalSellPrice: candidate.formalTargets.sellPrice,
      takeProfit1: candidate.shortAdvice.takeProfit1,
      takeProfit2: candidate.shortAdvice.takeProfit2,
      totalShares: 0,
      availableShares: 0,
      unrealizedProfit: 0,
      fatalRisk: false,
      hardStopTriggered: false,
      tSellEligible: false,
      tBuybackEligible: false,
    });
    if (signal.kind !== 'core_buy') throw new Error('candidate_not_at_core_buy_price');
    let availableCash: number;
    let currentInvested: number;
    let currentStockMarketValue: number;
    let currentPositionCount: number;
    let alreadyHoldsStock: boolean;

    if (confirmedAccount) {
      const valuedPositions = confirmedAccount.positions
        .filter(position => position.totalShares > 0)
        .map(position => {
          const currentQuote = realtime.quotes[position.code];
          if (!currentQuote) throw new Error('confirmed_position_quote_missing');
          return { code: position.code, marketValue: currentQuote.price * position.totalShares };
        });
      currentInvested = valuedPositions.reduce((sum, position) => sum + position.marketValue, 0);
      const existing = valuedPositions.find(position => position.code === candidate.code);
      availableCash = confirmedAccount.availableCash ?? 0;
      currentStockMarketValue = existing?.marketValue ?? 0;
      currentPositionCount = valuedPositions.length;
      alreadyHoldsStock = Boolean(existing);
    } else {
      const ledger = securitiesState?.positions.data;
      const currentPositions = ledger?.positions ?? [];
      currentInvested = currentPositions.reduce((sum, position) => sum + position.totalCost, 0);
      const existing = currentPositions.find(position => position.code === candidate.code);
      availableCash = Math.max(0, SHADOW_LIVE_TRADING_PROFILE.capitalPool - currentInvested);
      currentStockMarketValue = existing?.totalCost ?? 0;
      currentPositionCount = currentPositions.length;
      alreadyHoldsStock = Boolean(existing);
    }
    const risk = planLiveBuy({
      profile: SHADOW_LIVE_TRADING_PROFILE,
      feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      limitPrice: candidate.formalTargets.buyPrice,
      stopPrice: candidate.formalTargets.stopLoss,
      availableCash,
      currentInvested,
      currentStockMarketValue,
      currentPositionCount,
      alreadyHoldsStock,
      reservedTBuybackCash,
      realizedProfitToday: 0,
      paidFeesToday: 0,
      averageDailyAmount: realtime.quotes[candidate.code]?.amount ?? 0,
    });
    if (!risk.allowed) throw new Error(`shadow_order_blocked:${risk.reason}`);
    const now = new Date();
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`;
    const expiresAt = new Date(now.getTime() + SHADOW_LIVE_TRADING_PROFILE.orderTtlSeconds * 1_000).toISOString();
    const order: ShadowQualificationOrder = {
      id: `shadow-${id}`,
      idempotencyKey: `${accountId}:${candidate.code}:core_buy:${now.toISOString()}`,
      kind: 'core_buy', code: candidate.code, name: candidate.name, side: 'buy',
      limitPrice: candidate.formalTargets.buyPrice, shares: risk.shares,
      stopPrice: candidate.formalTargets.stopLoss, createdAt: now.toISOString(), expiresAt,
      requiresUserConfirmation: false, feeProfile: DEFAULT_TRADING_FEE_PROFILE,
      reasons: [...candidate.shortAdvice.reasons, ...candidate.mediumAdvice.reasons].slice(0, 4),
      status: 'submitted', submittedAt: now.toISOString(), filledShares: 0,
      averageFillPrice: null, brokerOrderId: null, failureKind: null,
      evidence: {
        scenario: 'core_buy',
        candidateSnapshot: { code: candidate.code, price: candidate.price, combinedScore: candidate.combinedScore, formalTargets: candidate.formalTargets },
        riskSnapshot: { ...risk },
        feeSnapshot: { entryFees: risk.entryFees, estimatedExitFees: risk.estimatedExitFees, profile: DEFAULT_TRADING_FEE_PROFILE },
      },
    };
    await window.electronTrading.submitShadowOrder({
      order_id: order.id, code: order.code, side: order.side,
      limit_price: order.limitPrice, shares: order.shares, expires_at: order.expiresAt,
    });
    store.append(order);
    const snapshot = store.snapshot();
    setOrders(snapshot.orders as ShadowQualificationOrder[]);
    setReservedTBuybackCash(snapshot.reservedTBuybackCash);
  }, [accountId, bridgeStatus.state, confirmedAccount, realtime.quotes, reservedTBuybackCash, securitiesState?.positions.data, store]);

  const qualification = evaluateShadowQualification(orders, probeReport);
  return {
    bridgeStatus, probeReport, candidates, orders, reservedTBuybackCash,
    validShadowOrders: qualification.validOrders,
    blockingFailures: qualification.blockingFailures,
    missingScenarios: qualification.missingScenarios,
    qualificationPassed: qualification.passed,
    probeReady: qualification.probeReady,
    analyzing, error, scanCandidates, runProbe, submitCandidate,
    accountDraft, confirmedAccount, accountReading, accountError,
    readEastmoneyAccount, confirmEastmoneyAccount, clearEastmoneyAccount,
  };
}

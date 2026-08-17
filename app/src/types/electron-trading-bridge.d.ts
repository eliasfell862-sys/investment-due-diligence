export {};

import type { EastmoneyOcrAccountSnapshot } from '../features/securities/live-trading/live-trading-types';

interface ElectronShadowOrderRequest {
  order_id: string;
  code: string;
  side: 'buy' | 'sell';
  limit_price: number;
  shares: number;
  expires_at: string;
}

declare global {
  interface Window {
    electronTrading?: {
      getStatus(): Promise<{ state: 'stopped' | 'starting' | 'ready' | 'failed'; port: number; lastError: string | null }>;
      runEastmoneyProbe(): Promise<unknown>;
      readEastmoneyAccount(): Promise<EastmoneyOcrAccountSnapshot>;
      submitShadowOrder(order: ElectronShadowOrderRequest): Promise<unknown>;
      cancelShadowOrder(orderId: string): Promise<unknown>;
    };
  }
}

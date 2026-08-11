import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../../../infrastructure/cloud/supabase-client';
import { CloudTTradingRepositoryBase as RepositoryBase } from './cloud-t-trading-repository';

export { CloudSecuritiesError } from './cloud-securities-repository-base';
export type { ExecuteTTradeSellInput, ExecuteTTradeBuybackInput, ResolveTTradeCycleInput, TTradeMutationResult } from './cloud-t-trading-repository';

interface CloudClientAccess {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: { message?: string } | null }> };
  from(table: string): {
    select(columns?: string): { eq(column: string, value: string): PromiseLike<{
      data: unknown[] | null; error: { message?: string } | null;
    }> };
  };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown; error: { message?: string } | null;
  }>;
}

export interface CloudWatchlistGroup { id: string; name: string; color: string }
export interface CloudWatchlist {
  id: string; name: string; createdAt: string; codes: string[];
  groups: CloudWatchlistGroup[]; codeGroups: Record<string, string[]>;
}
export interface CloudPositionBuyInput {
  alertId: string; code: string; name: string; shares: number; price: number;
  groupId: string; groupName: string; tradedAt: string;
}
export interface CloudPositionSellInput {
  alertId: string; code: string; shares: number; price: number; tradedAt: string;
}
export interface CloudManualPositionBuyInput {
  operationId: string; code: string; name: string; shares: number; price: number;
  groupId: string; groupName: string; tradedAt: string;
}
export interface CloudManualPositionSellInput {
  operationId: string; code: string; shares: number; price: number; tradedAt: string;
}
export interface CloudPositionGroupMoveInput {
  code: string; groupId: string; groupName: string; updatedAt: string;
}

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === 'object'
  ? value as Record<string, unknown> : {};
const asText = (value: unknown): string => typeof value === 'string' ? value : '';

function normalizeMetadata(value: unknown): Pick<CloudWatchlist, 'groups' | 'codeGroups'> {
  const metadata = asRecord(value);
  const groups = Array.isArray(metadata.groups) ? metadata.groups.map(asRecord).map(group => ({
    id: asText(group.id), name: asText(group.name), color: asText(group.color),
  })).filter(group => group.id && group.name) : [];
  const rawCodeGroups = asRecord(metadata.codeGroups);
  const codeGroups = Object.fromEntries(Object.entries(rawCodeGroups).map(([code, ids]) => [
    code, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
  ]));
  return { groups, codeGroups };
}

export class CloudSecuritiesRepository extends RepositoryBase {
  private readonly cloudClient: CloudClientAccess;

  constructor(client: CloudClientAccess = getSupabaseClient() as unknown as CloudClientAccess) {
    super(client as never);
    this.cloudClient = client;
  }

  private async authenticatedUserId(): Promise<string> {
    const { data, error } = await this.cloudClient.auth.getUser();
    if (error) throw new Error(error.message ?? '读取云账户失败');
    if (!data.user) throw new Error('云账户未登录');
    return data.user.id;
  }

  async loadWatchlists(): Promise<CloudWatchlist[]> {
    const userId = await this.authenticatedUserId();
    const [watchlistsResult, itemsResult] = await Promise.all([
      this.cloudClient.from('watchlists').select('*').eq('user_id', userId),
      this.cloudClient.from('watchlist_items').select('*').eq('user_id', userId),
    ]);
    if (watchlistsResult.error) throw new Error(watchlistsResult.error.message ?? '读取云端自选股池失败');
    if (itemsResult.error) throw new Error(itemsResult.error.message ?? '读取云端自选标的失败');
    const codesByWatchlist = new Map<string, string[]>();
    for (const itemValue of itemsResult.data ?? []) {
      const item = asRecord(itemValue);
      const watchlistId = asText(item.watchlist_id);
      const code = asText(item.code);
      if (watchlistId && /^\d{6}$/.test(code)) {
        codesByWatchlist.set(watchlistId, [...(codesByWatchlist.get(watchlistId) ?? []), code]);
      }
    }
    return (watchlistsResult.data ?? []).map(asRecord).map(item => ({
      id: asText(item.source_id) || asText(item.id),
      name: asText(item.name),
      createdAt: asText(item.created_at),
      codes: [...new Set(codesByWatchlist.get(asText(item.id)) ?? [])].sort(),
      ...normalizeMetadata(item.metadata),
    })).sort((left, right) => left.id.localeCompare(right.id));
  }

  async saveWatchlists(watchlists: CloudWatchlist[]): Promise<void> {
    await this.authenticatedUserId();
    const payload = {
      watchlists: watchlists.map(watchlist => ({
        source_id: watchlist.id,
        name: watchlist.name,
        created_at: watchlist.createdAt,
        codes: [...new Set(watchlist.codes.filter(code => /^\d{6}$/.test(code)))].sort(),
        metadata: { groups: watchlist.groups, codeGroups: watchlist.codeGroups },
      })),
    };
    const { error } = await this.cloudClient.rpc('replace_cloud_watchlists', { p_payload: payload });
    if (error) throw new Error(error.message ?? '保存云端自选股失败');
  }

  override async executeBuy(input: Record<string, unknown> | CloudPositionBuyInput): Promise<void> {
    const trade = input as unknown as CloudPositionBuyInput;
    await super.executeBuy({
      alert_id: trade.alertId, code: trade.code, name: trade.name,
      shares: trade.shares, price: trade.price,
      group_source_id: trade.groupId, group_name: trade.groupName, traded_at: trade.tradedAt,
    });
  }

  override async executeSell(input: Record<string, unknown> | CloudPositionSellInput): Promise<void> {
    const trade = input as unknown as CloudPositionSellInput;
    await super.executeSell({
      alert_id: trade.alertId, code: trade.code, shares: trade.shares,
      price: trade.price, traded_at: trade.tradedAt,
    });
  }

  async executeManualBuy(trade: CloudManualPositionBuyInput): Promise<void> {
    await this.callCloudRpc('execute_cloud_manual_position_buy', {
      operation_id: trade.operationId, code: trade.code, name: trade.name,
      shares: trade.shares, price: trade.price, group_source_id: trade.groupId,
      group_name: trade.groupName, traded_at: trade.tradedAt,
    });
  }

  async executeManualSell(trade: CloudManualPositionSellInput): Promise<void> {
    await this.callCloudRpc('execute_cloud_manual_position_sell', {
      operation_id: trade.operationId, code: trade.code, shares: trade.shares,
      price: trade.price, traded_at: trade.tradedAt,
    });
  }

  async movePositionGroup(input: CloudPositionGroupMoveInput): Promise<void> {
    await this.callCloudRpc('move_cloud_position_group', {
      code: input.code, group_source_id: input.groupId, group_name: input.groupName,
      updated_at: input.updatedAt,
    });
  }

  private async callCloudRpc(name: string, payload: Record<string, unknown>): Promise<void> {
    await this.authenticatedUserId();
    const { error } = await this.cloudClient.rpc(name, { p_payload: payload });
    if (error) throw new Error(error.message ?? `${name}失败`);
  }
}

export function createCloudSecuritiesRepository(client?: SupabaseClient): CloudSecuritiesRepository {
  return new CloudSecuritiesRepository(client as unknown as CloudClientAccess | undefined);
}

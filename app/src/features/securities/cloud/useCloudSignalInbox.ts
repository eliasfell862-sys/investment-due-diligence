import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../infrastructure/cloud/supabase-client';
import type { BacktestSignalAlertV3 } from '../backtest-signal-inbox-store';
import {
  createCloudSecuritiesRepository,
  mapCloudSignalAlert,
} from './cloud-securities-repository';

const SIGNAL_INBOX_LIMIT = 200;

interface SignalInboxRepository {
  loadSignalAlerts(): Promise<BacktestSignalAlertV3[]>;
  mapSignalAlert(value: unknown): BacktestSignalAlertV3;
  markAlertRead(alertId: string, readAt: string): Promise<void>;
}
interface RealtimePayload {
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  new?: unknown;
  old?: unknown;
}
interface RealtimeChannelLike {
  on(
    event: string,
    filter: Record<string, unknown>,
    callback: (payload: RealtimePayload) => void,
  ): RealtimeChannelLike;
  subscribe(): RealtimeChannelLike;
}
interface RealtimeClientLike {
  channel(name: string): RealtimeChannelLike;
  removeChannel(channel: RealtimeChannelLike): unknown;
}
interface CloudSignalInboxDependencies {
  repository: SignalInboxRepository;
  client: RealtimeClientLike;
}

function defaultRepository(): SignalInboxRepository {
  const repository = createCloudSecuritiesRepository();
  return {
    loadSignalAlerts: () => repository.loadSignalAlerts(),
    mapSignalAlert: mapCloudSignalAlert,
    async markAlertRead(alertId, readAt) {
      const { error } = await getSupabaseClient().rpc('mark_cloud_signal_alert_read', {
        p_alert_id: alertId,
        p_read_at: readAt,
      });
      if (error) throw error;
    },
  };
}

function uniqueNewestFirst(alerts: BacktestSignalAlertV3[]): BacktestSignalAlertV3[] {
  const byId = new Map<string, BacktestSignalAlertV3>();
  for (const alert of alerts) {
    if (alert.id && !byId.has(alert.id)) byId.set(alert.id, alert);
  }
  return [...byId.values()]
    .sort((left, right) => right.signalAt.localeCompare(left.signalAt)
      || right.id.localeCompare(left.id))
    .slice(0, SIGNAL_INBOX_LIMIT);
}

function realtimeId(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' ? id : '';
}

export function useCloudSignalInbox(userId: string, dependencies?: CloudSignalInboxDependencies) {
  const repositoryRef = useRef<SignalInboxRepository>(dependencies?.repository ?? defaultRepository());
  const clientRef = useRef<RealtimeClientLike>(
    dependencies?.client ?? getSupabaseClient() as unknown as RealtimeClientLike,
  );
  const [alerts, setAlerts] = useState<BacktestSignalAlertV3[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    try {
      setAlerts(uniqueNewestFirst(await repositoryRef.current.loadSignalAlerts()));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    const channel = clientRef.current.channel('signal-alerts:' + userId).on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_alerts', filter: 'user_id=eq.' + userId,
    }, payload => {
      if (payload.eventType === 'DELETE') {
        const deletedId = realtimeId(payload.old);
        if (deletedId) setAlerts(current => current.filter(alert => alert.id !== deletedId));
        return;
      }
      if (payload.eventType !== 'INSERT' && payload.eventType !== 'UPDATE') return;
      const next = repositoryRef.current.mapSignalAlert(payload.new);
      if (!next.id) return;
      setAlerts(current => uniqueNewestFirst([next, ...current]));
    }).subscribe();
    return () => { void clientRef.current.removeChannel(channel); };
  }, [reload, userId]);

  const markRead = useCallback(async (alertId: string) => {
    const readAt = new Date().toISOString();
    await repositoryRef.current.markAlertRead(alertId, readAt);
    setAlerts(current => current.map(alert => alert.id === alertId ? { ...alert, readAt } : alert));
  }, []);
  const unreadCount = useMemo(() => alerts.filter(alert => !alert.readAt).length, [alerts]);
  return { alerts, loading, error, unreadCount, reload, markRead };
}

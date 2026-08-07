import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseClient } from '../../../infrastructure/cloud/supabase-client';
import type { BacktestSignalAlertV3 } from '../backtest-signal-inbox-store';
import { createCloudSecuritiesRepository } from './cloud-securities-repository';

interface SignalInboxRepository {
  loadSignalAlerts(): Promise<BacktestSignalAlertV3[]>;
  markAlertRead(alertId: string, readAt: string): Promise<void>;
}
interface RealtimeChannelLike {
  on(event: string, filter: Record<string, unknown>, callback: () => void): RealtimeChannelLike;
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
  for (const alert of alerts) byId.set(alert.id, alert);
  return [...byId.values()].sort((left, right) => right.signalAt.localeCompare(left.signalAt)
    || right.id.localeCompare(left.id));
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
    const channel = clientRef.current.channel(`signal-alerts:${userId}`).on('postgres_changes', {
      event: '*', schema: 'public', table: 'signal_alerts', filter: `user_id=eq.${userId}`,
    }, () => { void reload(); }).subscribe();
    return () => { void clientRef.current.removeChannel(channel); };
  }, [reload, userId]);

  const markRead = useCallback(async (alertId: string) => {
    await repositoryRef.current.markAlertRead(alertId, new Date().toISOString());
    await reload();
  }, [reload]);
  const unreadCount = useMemo(() => alerts.filter(alert => !alert.readAt).length, [alerts]);
  return { alerts, loading, error, unreadCount, reload, markRead };
}

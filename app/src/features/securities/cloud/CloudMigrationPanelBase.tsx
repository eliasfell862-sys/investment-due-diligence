import { useMemo, useState } from 'react';
import { getSupabaseClient } from '../../../infrastructure/cloud/supabase-client';
import {
  buildLocalMigration,
  type CloudMigrationPayload,
} from './local-cloud-migration';

export interface LocalCloudMigrationRepository {
  importLocalState(payload: CloudMigrationPayload): Promise<void>;
}

interface CloudMigrationPanelProps {
  userId: string;
  repository?: LocalCloudMigrationRepository;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

export function cloudMigrationCompletionKey(userId: string): string {
  return `sec_cloud_migration_completed_v1:${userId}`;
}

function defaultRepository(): LocalCloudMigrationRepository {
  return {
    async importLocalState(payload) {
      const { error } = await getSupabaseClient().rpc('import_local_securities_state', {
        p_migration_id: payload.migrationId,
        p_payload: payload,
      });
      if (error) throw error;
    },
  };
}

export function CloudMigrationPanel({
  userId,
  repository = defaultRepository(),
  storage = localStorage,
}: CloudMigrationPanelProps) {
  const result = useMemo(() => {
    try {
      return { payload: buildLocalMigration(storage, userId), error: '' };
    } catch (error) {
      return {
        payload: null,
        error: error instanceof Error ? error.message : '本地证券数据无法读取',
      };
    }
  }, [storage, userId]);
  const completionKey = cloudMigrationCompletionKey(userId);
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(result.error);
  const [completed, setCompleted] = useState(
    () => Boolean(result.payload && storage.getItem(completionKey) === result.payload.migrationId),
  );

  if (!result.payload) {
    return <aside className="card cloud-migration-panel" role="alert">本地数据暂不能迁移：{error}</aside>;
  }

  const payload = result.payload;
  const totalLocalRows = payload.watchlists.length + payload.watchlistItems.length
    + payload.positions.length + payload.positionTransactions.length
    + payload.signalAlerts.length + payload.virtualLedger.transactions.length;
  if (totalLocalRows === 0) return null;

  const submit = async () => {
    if (!confirmed || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await repository.importLocalState(payload);
      storage.setItem(completionKey, payload.migrationId);
      setCompleted(true);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '云端导入失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <aside className="card cloud-migration-panel" aria-label="本地证券数据迁移">
      <h2>把现有证券数据同步到云端</h2>
      {completed ? (
        <p role="status">本地数据已安全导入云端</p>
      ) : (
        <>
          <p>导入完成后，网站关闭期间的常驻监控也能读取同一份自选股、持仓和信号状态。</p>
          <ul>
            <li>{payload.watchlists.length} 个自选股池</li>
            <li>{payload.watchlistItems.length} 个自选标的</li>
            <li>{payload.positions.length} 个实际持仓</li>
            <li>{payload.signalAlerts.length} 条历史信号</li>
            <li>{payload.virtualLedger.positions.length} 个虚拟持仓</li>
          </ul>
          <label>
            <input
              type="checkbox"
              checked={confirmed}
              onChange={event => setConfirmed(event.target.checked)}
            />
            确认把上述本地数据导入云端
          </label>
          <button className="button" type="button" disabled={!confirmed || submitting} onClick={() => void submit()}>
            {submitting ? '正在导入…' : '导入云端'}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}

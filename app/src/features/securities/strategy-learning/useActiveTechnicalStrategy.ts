import { useCallback, useEffect, useState } from 'react';
import { strategyLearningDb } from './strategy-learning-db';
import { StrategyLearningRepository } from './strategy-learning-repository';
import { StrategyApprovalService } from './strategy-approval-service';
import { DEFAULT_TECHNICAL_STRATEGY_CONFIG, validateTechnicalStrategyConfig,
  type TechnicalStrategyConfig } from './technical-strategy-config';

const service = new StrategyApprovalService(new StrategyLearningRepository(strategyLearningDb));

export function useActiveTechnicalStrategy() {
  const [config, setConfig] = useState<TechnicalStrategyConfig>(DEFAULT_TECHNICAL_STRATEGY_CONFIG);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const active = await service.getActiveStrategy('realtime-technical');
      setConfig(validateTechnicalStrategyConfig(active.config as unknown as TechnicalStrategyConfig));
      setError('');
    } catch (reason) {
      setConfig(DEFAULT_TECHNICAL_STRATEGY_CONFIG);
      setError(reason instanceof Error ? reason.message : '正式策略加载失败，已使用版本1');
    }
  }, []);

  useEffect(() => {
    void reload();
    const listener = () => { void reload(); };
    window.addEventListener('sec-strategy-version-changed', listener);
    return () => window.removeEventListener('sec-strategy-version-changed', listener);
  }, [reload]);
  return { config, error, reload };
}

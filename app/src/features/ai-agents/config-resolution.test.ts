import { describe, expect, it } from 'vitest';

import { resolveAiModelProfile } from './config-resolution';
import type { AiAgentSettings, AiModelProfile } from './types';

const defaultProfile: AiModelProfile = {
  providerId: 'openai',
  model: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  temperature: 0.2,
  maxOutputTokens: 2_000,
  secretId: 'default:openai',
};

const securitiesProfile: AiModelProfile = {
  providerId: 'deepseek',
  model: 'deepseek-chat',
  endpoint: 'https://api.deepseek.com/chat/completions',
  temperature: 0.1,
  maxOutputTokens: 3_000,
  secretId: 'securities:deepseek',
};

const settings: AiAgentSettings = {
  defaultProfile,
  featureOverrides: { securities: securitiesProfile },
  connectionStatuses: {},
  updatedAt: '2026-08-07T00:00:00.000Z',
};

describe('resolveAiModelProfile', () => {
  it('uses a feature override for tasks in that group', () => {
    const resolved = resolveAiModelProfile(settings, 'securities.watchlist');

    expect(resolved).toEqual({
      profile: securitiesProfile,
      source: 'feature_override',
      featureGroup: 'securities',
    });
  });

  it('falls back to the global default without inventing another model', () => {
    const resolved = resolveAiModelProfile(settings, 'due_diligence.research');

    expect(resolved).toEqual({
      profile: defaultProfile,
      source: 'default',
      featureGroup: 'due_diligence',
    });
    expect(resolved.profile).toBe(settings.defaultProfile);
  });

  it.each([
    ['due_diligence.reasoning', 'due_diligence'],
    ['due_diligence.research', 'due_diligence'],
    ['document.extraction', 'due_diligence'],
    ['securities.stock_analysis', 'securities'],
    ['securities.watchlist', 'securities'],
    ['securities.portfolio', 'securities'],
    ['securities.multi_agent', 'securities'],
  ] as const)('maps %s to %s', (taskId, featureGroup) => {
    expect(resolveAiModelProfile(settings, taskId).featureGroup).toBe(featureGroup);
  });
});

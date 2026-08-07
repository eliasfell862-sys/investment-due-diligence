import type { AiAgentSettings, AiFeatureGroup, AiModelProfile, AiTaskId } from './types';

const TASK_FEATURE_GROUPS: Record<AiTaskId, AiFeatureGroup> = {
  'due_diligence.reasoning': 'due_diligence',
  'due_diligence.research': 'due_diligence',
  'document.extraction': 'due_diligence',
  'securities.stock_analysis': 'securities',
  'securities.watchlist': 'securities',
  'securities.portfolio': 'securities',
  'securities.multi_agent': 'securities',
};

export interface ResolvedAiModelProfile {
  profile: AiModelProfile;
  source: 'feature_override' | 'default';
  featureGroup: AiFeatureGroup;
}

export function resolveAiModelProfile(
  settings: AiAgentSettings,
  taskId: AiTaskId,
): ResolvedAiModelProfile {
  const featureGroup = TASK_FEATURE_GROUPS[taskId];
  const featureOverride = settings.featureOverrides[featureGroup];

  if (featureOverride) {
    return {
      profile: featureOverride,
      source: 'feature_override',
      featureGroup,
    };
  }

  return {
    profile: settings.defaultProfile,
    source: 'default',
    featureGroup,
  };
}

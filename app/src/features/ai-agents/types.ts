export type AiProviderId =
  | 'deepseek'
  | 'kimi'
  | 'qwen'
  | 'glm'
  | 'doubao'
  | 'openai'
  | 'ollama'
  | 'custom';

export type AiFeatureGroup = 'due_diligence' | 'securities';

export type AiTaskId =
  | 'due_diligence.reasoning'
  | 'due_diligence.research'
  | 'document.extraction'
  | 'securities.stock_analysis'
  | 'securities.watchlist'
  | 'securities.portfolio'
  | 'securities.multi_agent';

export interface AiModelProfile {
  providerId: AiProviderId;
  model: string;
  endpoint: string;
  temperature: number;
  maxOutputTokens: number;
  secretId?: string;
}

export interface AiConnectionStatus {
  verifiedAt: string;
  latencyMs: number;
  actualModel: string;
}

export interface AiAgentSettings {
  defaultProfile: AiModelProfile;
  featureOverrides: Partial<Record<AiFeatureGroup, AiModelProfile>>;
  connectionStatuses: Partial<Record<AiFeatureGroup | 'default', AiConnectionStatus>>;
  updatedAt: string;
}

export interface AiSecretDescriptor {
  id: string;
  providerId: AiProviderId;
  lastFour: string;
}

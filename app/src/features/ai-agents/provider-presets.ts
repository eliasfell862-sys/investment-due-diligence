import type { AiModelProfile, AiProviderId } from './types';

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  endpoint: string;
  defaultModel: string;
  needsKey: boolean;
  browserDirect: boolean;
}

export const AI_PROVIDER_PRESETS = {
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-chat',
    needsKey: true,
    browserDirect: true,
  },
  kimi: {
    id: 'kimi',
    label: 'Kimi / Moonshot',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    needsKey: true,
    browserDirect: true,
  },
  qwen: {
    id: 'qwen',
    label: '通义千问 / DashScope',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    needsKey: true,
    browserDirect: true,
  },
  glm: {
    id: 'glm',
    label: '智谱 GLM',
    endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-4-flash',
    needsKey: true,
    browserDirect: true,
  },
  doubao: {
    id: 'doubao',
    label: '豆包 / 火山方舟',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'doubao-pro-32k',
    needsKey: true,
    browserDirect: true,
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o-mini',
    needsKey: true,
    browserDirect: true,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    defaultModel: 'qwen2.5:14b',
    needsKey: false,
    browserDirect: true,
  },
  custom: {
    id: 'custom',
    label: '自定义 OpenAI 兼容接口',
    endpoint: '',
    defaultModel: '',
    needsKey: true,
    browserDirect: true,
  },
} satisfies Record<AiProviderId, AiProviderPreset>;

const LOCAL_OLLAMA_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function validateAiEndpoint(profile: AiModelProfile): void {
  let endpoint: URL;

  try {
    endpoint = new URL(profile.endpoint);
  } catch {
    throw new Error('AI Endpoint 格式无效');
  }

  if (endpoint.protocol === 'https:') {
    return;
  }

  const isLocalOllama =
    profile.providerId === 'ollama' &&
    endpoint.protocol === 'http:' &&
    LOCAL_OLLAMA_HOSTS.has(endpoint.hostname.toLowerCase());

  if (!isLocalOllama) {
    throw new Error('远程 AI Endpoint 必须使用 HTTPS');
  }
}

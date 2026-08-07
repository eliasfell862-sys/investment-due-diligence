import type { AiModelProfile, AiProviderId } from './types';

export type AiGatewayErrorCode =
  | 'vault_locked'
  | 'missing_key'
  | 'invalid_key'
  | 'permission_denied'
  | 'insufficient_balance'
  | 'rate_limited'
  | 'model_not_found'
  | 'cors_blocked'
  | 'timeout'
  | 'network_error'
  | 'invalid_response'
  | 'provider_error';

export class AiGatewayError extends Error {
  readonly code: AiGatewayErrorCode;
  readonly userMessage: string;

  constructor(code: AiGatewayErrorCode, userMessage: string) {
    super(userMessage);
    this.name = 'AiGatewayError';
    this.code = code;
    this.userMessage = userMessage;
  }
}

export interface AiTaskResult {
  content: string;
  providerId: AiProviderId;
  model: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
}

export type AiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleRequest {
  profile: AiModelProfile;
  key: string | null;
  systemPrompt: string;
  userPrompt: string;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
  fetchImpl?: AiFetch;
}

const ERROR_MESSAGES: Record<AiGatewayErrorCode, string> = {
  vault_locked: '本机 AI 密钥库已锁定，请先解锁',
  missing_key: '请先配置并保存该模型的 API Key',
  invalid_key: 'API Key 无效，请检查后重新保存',
  permission_denied: '当前 API Key 没有调用该模型的权限',
  insufficient_balance: 'AI 供应商账户余额或额度不足',
  rate_limited: '请求过于频繁，请稍后再试',
  model_not_found: '所选模型不存在或当前账户无权访问',
  cors_blocked: '浏览器无法直接访问该接口，请检查 CORS 或使用自有兼容网关',
  timeout: 'AI 请求超时，请稍后重试',
  network_error: '网络连接失败，请检查网络和 Endpoint',
  invalid_response: 'AI 接口返回了无法识别的数据',
  provider_error: 'AI 供应商返回错误，请检查配置后重试',
};

export function createAiGatewayError(
  code: AiGatewayErrorCode,
  userMessage = ERROR_MESSAGES[code],
): AiGatewayError {
  return new AiGatewayError(code, userMessage);
}

function errorFromHttp(status: number, responsePreview: string): AiGatewayError {
  const normalized = responsePreview.toLowerCase();
  if (
    normalized.includes('insufficient balance') ||
    responsePreview.includes('余额不足') ||
    normalized.includes('quota exceeded')
  ) {
    return createAiGatewayError('insufficient_balance');
  }
  if (status === 401) return createAiGatewayError('invalid_key');
  if (status === 403) return createAiGatewayError('permission_denied');
  if (status === 404) return createAiGatewayError('model_not_found');
  if (status === 429) return createAiGatewayError('rate_limited');
  return createAiGatewayError('provider_error');
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function executeOpenAiCompatibleRequest(
  request: OpenAiCompatibleRequest,
): Promise<AiTaskResult> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), request.timeoutMs ?? 60_000);
  const startedAt = performance.now();
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (request.profile.providerId !== 'ollama' && request.key) {
    headers.set('Authorization', `Bearer ${request.key}`);
  }

  const body: Record<string, unknown> = {
    model: request.profile.model,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: request.userPrompt },
    ],
    temperature: request.profile.temperature,
    max_tokens: request.profile.maxOutputTokens,
  };
  if (request.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  try {
    const response = await fetchImpl(request.profile.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      throw errorFromHttp(response.status, responseText.slice(0, 500));
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw createAiGatewayError('invalid_response');
    }

    const data = payload as {
      model?: unknown;
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw createAiGatewayError('invalid_response');
    }

    return {
      content,
      providerId: request.profile.providerId,
      model: typeof data.model === 'string' ? data.model : request.profile.model,
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      inputTokens: nullableNumber(data.usage?.prompt_tokens),
      outputTokens: nullableNumber(data.usage?.completion_tokens),
      finishReason:
        typeof data.choices?.[0]?.finish_reason === 'string'
          ? data.choices[0].finish_reason
          : null,
    };
  } catch (error) {
    if (error instanceof AiGatewayError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw createAiGatewayError('timeout');
    }
    if (error instanceof TypeError && error.message.toLowerCase().includes('failed to fetch')) {
      const online = typeof navigator === 'undefined' || navigator.onLine;
      throw createAiGatewayError(online ? 'cors_blocked' : 'network_error');
    }
    throw createAiGatewayError('network_error');
  } finally {
    window.clearTimeout(timeout);
  }
}

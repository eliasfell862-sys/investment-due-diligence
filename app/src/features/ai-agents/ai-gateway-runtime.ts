import { createAiGatewayError } from './ai-provider-adapter';
import type { AiGatewayRuntime } from './ai-gateway';

/**
 * Gateway 运行时注册表。
 *
 * AiVaultProvider 在密钥库解锁期间注册 { settings, resolveSecret }，
 * 锁定、登出或切换账户时注销。引擎层（非 React 模块）通过
 * getAiGatewayRuntime() 获取运行时调用 executeAiTask，
 * 因此页面无需为引擎传递密钥库上下文。
 *
 * 明文 Key 仍只存在于 Provider 内存中，注册表只保存引用，不保存 Key 本体。
 */

let activeRuntime: AiGatewayRuntime | null = null;

export function registerAiGatewayRuntime(runtime: AiGatewayRuntime): void {
  activeRuntime = runtime;
}

export function unregisterAiGatewayRuntime(): void {
  activeRuntime = null;
}

export function getAiGatewayRuntime(): AiGatewayRuntime {
  if (!activeRuntime || !activeRuntime.settings) {
    throw createAiGatewayError('vault_locked');
  }
  return activeRuntime;
}

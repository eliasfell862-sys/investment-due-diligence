import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AiGatewayError } from '../ai-agents/ai-gateway';
import type { AiAgentSettings } from '../ai-agents/types';
import { ResearchPage } from './ResearchPage';

const mocks = vi.hoisted(() => ({
  vault: null as {
    locked: boolean;
    settings: AiAgentSettings | null;
    resolveSecret: (secretId: string) => string | null;
  } | null,
  executeAiTask: vi.fn(),
}));

vi.mock('../ai-agents/useAiVault', () => ({ useAiVault: () => mocks.vault }));
vi.mock('../ai-agents/ai-gateway', async (importOriginal) => {
  const original = await importOriginal<typeof import('../ai-agents/ai-gateway')>();
  return { ...original, executeAiTask: mocks.executeAiTask };
});

const unlockedSettings: AiAgentSettings = {
  defaultProfile: {
    providerId: 'deepseek', model: 'deepseek-chat',
    endpoint: 'https://api.deepseek.com/chat/completions',
    temperature: 0.2, maxOutputTokens: 2000, secretId: 'default:deepseek',
  },
  featureOverrides: {}, connectionStatuses: {}, updatedAt: '2026-08-07T00:00:00.000Z',
};

function renderPage() {
  return render(<MemoryRouter><ResearchPage /></MemoryRouter>);
}

describe('ResearchPage via AI Gateway', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.executeAiTask.mockReset();
    mocks.vault = { locked: true, settings: null, resolveSecret: () => null };
  });

  it('links to the AI Agent settings when the vault is locked and renders no API Key input', () => {
    renderPage();
    expect(screen.getByRole('link', { name: '配置 AI Agent' })).toHaveAttribute('href', '/ai-agents');
    expect(screen.queryByLabelText(/API Key/i)).not.toBeInTheDocument();
    expect(screen.queryByText('API Configuration')).not.toBeInTheDocument();
  });

  it('runs the due_diligence.research task through the Gateway without touching any Key', async () => {
    mocks.vault = { locked: false, settings: unlockedSettings, resolveSecret: vi.fn(() => null) };
    mocks.executeAiTask.mockResolvedValue({
      content: '这是一段研究摘要。\n\nSOURCES:\n- 示例来源 https://example.com/report',
      providerId: 'deepseek', model: 'deepseek-chat', latencyMs: 12,
      inputTokens: 10, outputTokens: 5, finishReason: 'stop',
    });
    renderPage();

    fireEvent.change(screen.getByLabelText('Company'), { target: { value: '测试公司' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Research' }));

    await waitFor(() => expect(mocks.executeAiTask).toHaveBeenCalledTimes(1));
    const [request, runtime] = mocks.executeAiTask.mock.calls[0]!;
    expect(request.taskId).toBe('due_diligence.research');
    expect(request.systemPrompt).toContain('投资研究助手');
    expect(request.userPrompt).toContain('Company: 测试公司');
    expect(request).not.toHaveProperty('apiKey');
    expect(runtime.settings).toBe(unlockedSettings);
    expect(typeof runtime.resolveSecret).toBe('function');

    expect(await screen.findByText('这是一段研究摘要。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /示例来源/ })).toHaveAttribute('href', 'https://example.com/report');
  });

  it('displays the normalized Chinese message when the Gateway fails', async () => {
    mocks.vault = { locked: false, settings: unlockedSettings, resolveSecret: vi.fn(() => null) };
    mocks.executeAiTask.mockRejectedValue(new AiGatewayError('invalid_key', 'API Key 无效，请在 AI Agent 配置中更新'));
    renderPage();

    fireEvent.change(screen.getByLabelText('Company'), { target: { value: '测试公司' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run Research' }));

    expect(await screen.findByText('API Key 无效，请在 AI Agent 配置中更新')).toBeInTheDocument();
  });

  it('renders no legacy provider configuration form when unlocked', () => {
    mocks.vault = { locked: false, settings: unlockedSettings, resolveSecret: vi.fn(() => null) };
    renderPage();
    expect(screen.queryByText('API Configuration')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Model \(optional\)/)).not.toBeInTheDocument();
  });
});

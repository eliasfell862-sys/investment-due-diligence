import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '../../domain/project/project';
import { NewProjectPage } from './NewProjectPage';

function LocationProbe() {
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

const renderPage = (onCreate: (project: Project) => Promise<void>) =>
  render(
    <MemoryRouter initialEntries={['/projects/new']}>
      <NewProjectPage onCreate={onCreate} />
      <LocationProbe />
    </MemoryRouter>,
  );

describe('NewProjectPage', () => {
  it('creates a project with combined templates', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<MemoryRouter><NewProjectPage onCreate={onCreate} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText('项目名称'), '硬件 SaaS 示例');
    await userEvent.selectOptions(screen.getByLabelText('投资阶段'), 'vc_early');
    await userEvent.click(screen.getByLabelText('SaaS / 软件'));
    await userEvent.click(screen.getByLabelText('硬科技 / 制造'));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: '硬件 SaaS 示例',
      dealProfile: expect.objectContaining({ strategy: 'vc_early', industryTemplateIds: ['saas', 'hardtech_manufacturing'] }),
    }));
  });

  it('navigates to the persisted project after creating it', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderPage(onCreate);

    await userEvent.type(screen.getByLabelText('项目名称'), '边界测试');
    await userEvent.click(screen.getByLabelText('消费品'));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

    expect(onCreate).toHaveBeenCalledOnce();
    const created = onCreate.mock.calls[0]?.[0];
    expect(created).toBeDefined();
    await waitFor(() =>
      expect(screen.getByLabelText('current path')).toHaveTextContent(`/projects/${created!.id}`),
    );
  });

  it('rejects a whitespace-only project name', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderPage(onCreate);

    const nameInput = screen.getByLabelText('项目名称');
    await userEvent.type(nameInput, '   ');
    await userEvent.click(screen.getByLabelText('SaaS / 软件'));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入项目名称');
    expect(nameInput).toHaveAttribute('aria-describedby', 'project-name-error');
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('requires at least one industry template', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderPage(onCreate);

    await userEvent.type(screen.getByLabelText('项目名称'), '消费项目');
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('请至少选择一个行业模板');
    expect(screen.getByRole('group', { name: '行业模板（可组合）' })).toHaveAttribute(
      'aria-describedby',
      'project-templates-error',
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('retains form values and allows retry after save failure', async () => {
    const onCreate = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce(undefined);
    renderPage(onCreate);

    const nameInput = screen.getByLabelText('项目名称');
    const strategy = screen.getByLabelText('投资阶段');
    const template = screen.getByLabelText('硬科技 / 制造');
    await userEvent.type(nameInput, '重试项目');
    await userEvent.selectOptions(strategy, 'pe_buyout');
    await userEvent.click(template);
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('项目保存失败，请重试。');
    expect(nameInput).toHaveValue('重试项目');
    expect(strategy).toHaveValue('pe_buyout');
    expect(template).toBeChecked();
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled();

    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('项目保存失败，请重试。')).not.toBeInTheDocument());
  });

  it('disables submission and ignores a second click while saving', async () => {
    let resolveCreate: (() => void) | undefined;
    const onCreate = vi.fn(() => new Promise<void>((resolve) => {
      resolveCreate = resolve;
    }));
    renderPage(onCreate);

    await userEvent.type(screen.getByLabelText('项目名称'), '并发项目');
    await userEvent.click(screen.getByLabelText('消费品'));
    const submitButton = screen.getByRole('button', { name: '创建项目' });
    await userEvent.click(submitButton);

    expect(screen.getByRole('button', { name: '正在创建…' })).toBeDisabled();
    await userEvent.click(submitButton);
    expect(onCreate).toHaveBeenCalledOnce();

    resolveCreate?.();
    await waitFor(() => expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled());
  });
});

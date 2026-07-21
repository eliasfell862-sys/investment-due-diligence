import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NewProjectPage } from './NewProjectPage';

function LocationProbe() {
  return <output aria-label="current path">{useLocation().pathname}</output>;
}

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

  it('leaves navigation to the caller after creating a project', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter initialEntries={['/projects/new']}>
        <NewProjectPage onCreate={onCreate} />
        <LocationProbe />
      </MemoryRouter>,
    );

    await userEvent.type(screen.getByLabelText('项目名称'), '边界测试');
    await userEvent.click(screen.getByLabelText('消费品'));
    await userEvent.click(screen.getByRole('button', { name: '创建项目' }));

    expect(onCreate).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('current path')).toHaveTextContent('/projects/new');
  });
});

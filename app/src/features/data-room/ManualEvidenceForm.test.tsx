import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StoredDocument } from '../../infrastructure/db/app-db';
import { ManualEvidenceForm } from './ManualEvidenceForm';

const sourceDocument: StoredDocument = {
  id: 'document-1',
  projectId: 'project-1',
  name: '星云科技 BP.pdf',
  mimeType: 'application/pdf',
  size: 1,
  uploadedAt: '2026-07-24T00:00:00.000Z',
  parseStatus: 'partial',
  blob: new Blob(['x']),
};

function renderForm(saveMany = vi.fn().mockResolvedValue(undefined)) {
  render(
    <ManualEvidenceForm
      projectId="project-1"
      documents={[sourceDocument]}
      initialDocumentId="document-1"
      evidenceRepository={{ saveMany }}
      onClose={vi.fn()}
    />,
  );
  return saveMany;
}

describe('ManualEvidenceForm', () => {
  it('saves a located document fact through formal evidence persistence', async () => {
    const saveMany = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('目标字段'), 'revenue');
    await userEvent.type(screen.getByLabelText('字段值'), '120000000');
    await userEvent.type(screen.getByLabelText('期间标识'), '2025');
    await userEvent.type(
      screen.getByLabelText('来源定位'),
      '第12页 / 表格2 / 第4行第3列',
    );

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));

    await waitFor(() => expect(saveMany).toHaveBeenCalledOnce());
    expect(saveMany.mock.calls[0]?.[0][0]).toMatchObject({
      sourceType: 'document_fact',
      sourceDocumentId: 'document-1',
      normalizedValue: '120000000',
      sourceLocator: '第12页 / 表格2 / 第4行第3列',
    });
    expect(await screen.findByText('人工证据已保存')).toBeInTheDocument();
  });

  it.each([
    ['interview', '人工访谈'],
    ['investor_assumption', '投资者假设'],
  ])('preserves %s as a distinct source type', async (sourceType, locator) => {
    const saveMany = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('来源类型'), sourceType);
    await userEvent.selectOptions(screen.getByLabelText('目标字段'), 'team_summary');
    await userEvent.type(screen.getByLabelText('字段值'), '核心团队具备行业经验');
    await userEvent.type(
      screen.getByLabelText('来源说明'),
      '2026年7月管理层访谈及投资人判断',
    );

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));

    await waitFor(() => expect(saveMany).toHaveBeenCalledOnce());
    expect(saveMany.mock.calls[0]?.[0][0]).toMatchObject({
      sourceType,
      sourceLocator: locator,
    });
  });

  it('saves a documented management forecast with an explicit period', async () => {
    const saveMany = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('来源类型'), 'management_forecast');
    await userEvent.selectOptions(screen.getByLabelText('目标字段'), 'revenue');
    await userEvent.type(screen.getByLabelText('字段值'), '200000000');
    await userEvent.type(screen.getByLabelText('期间标识'), 'FY2027');
    await userEvent.type(screen.getByLabelText('来源定位'), '第20页 / 预测表');
    await userEvent.type(screen.getByLabelText('来源说明'), '管理层预算口径');

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));

    await waitFor(() => expect(saveMany).toHaveBeenCalledOnce());
    expect(saveMany.mock.calls[0]?.[0][0]).toMatchObject({
      sourceType: 'management_forecast',
      sourceDocumentId: 'document-1',
      sourceLocator: '第20页 / 预测表',
      periodIdentity: 'FY2027',
      normalizedValue: '200000000',
    });
  });

  it('requires an explicit period and source for management forecasts', async () => {
    const saveMany = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('来源类型'), 'management_forecast');
    await userEvent.selectOptions(screen.getByLabelText('目标字段'), 'revenue');
    await userEvent.type(screen.getByLabelText('字段值'), '200000000');

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      '管理层预测必须填写明确期间',
    );
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('validates numeric fields and mandatory source details without fabricating values', async () => {
    const saveMany = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('目标字段'), 'revenue');
    await userEvent.type(screen.getByLabelText('字段值'), '十二亿元');

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的字段值');
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('requires a locator for document facts', async () => {
    const saveMany = renderForm();
    await userEvent.selectOptions(screen.getByLabelText('目标字段'), 'company_name');
    await userEvent.type(screen.getByLabelText('字段值'), '星云科技');

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));

    expect(screen.getByRole('alert')).toHaveTextContent('请填写来源定位');
    expect(saveMany).not.toHaveBeenCalled();
  });

  it('shows persistence errors and allows a deterministic retry', async () => {
    const saveMany = vi.fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    renderForm(saveMany);
    await userEvent.selectOptions(screen.getByLabelText('来源类型'), 'investor_assumption');
    await userEvent.selectOptions(screen.getByLabelText('目标字段'), 'team_summary');
    await userEvent.type(screen.getByLabelText('字段值'), '投资判断');
    await userEvent.type(screen.getByLabelText('来源说明'), '基于当前尽调资料');

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('人工证据保存失败');

    await userEvent.click(screen.getByRole('button', { name: '保存正式证据' }));
    await waitFor(() => expect(saveMany).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('人工证据已保存')).toBeInTheDocument();
  });
});

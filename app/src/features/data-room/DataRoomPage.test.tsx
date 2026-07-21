import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppDb } from '../../infrastructure/db/app-db';
import { FileVault } from '../../infrastructure/files/file-vault';
import { DataRoomPage } from './DataRoomPage';

describe('DataRoomPage', () => {
  it('accepts the vault prop for local uploads', async () => {
    const db = new AppDb(`data-room-${crypto.randomUUID()}`);
    const vault = new FileVault(db);
    render(<DataRoomPage projectId="p1" vault={vault} />);

    fireEvent.change(screen.getByLabelText('上传资料'), {
      target: { files: [new File(['sample'], 'bp.pdf', { type: 'application/pdf' })] },
    });

    expect(await screen.findByText('bp.pdf')).toBeInTheDocument();
    await db.delete();
  });
});

import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createTradingBridgeManager } = require('./trading-bridge-manager.cjs') as {
  createTradingBridgeManager: (dependencies: Record<string, unknown>) => {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    publicStatus: () => Record<string, unknown>;
    runEastmoneyProbe: () => Promise<unknown>;
    readEastmoneyAccount: () => Promise<unknown>;
  };
};

function response(payload: unknown = { status: 'ok' }) {
  return { ok: true, status: 200, json: vi.fn().mockResolvedValue(payload) };
}

describe('trading bridge manager', () => {
  it('starts hidden with a random token and loopback host without exposing the token', async () => {
    const child = { kill: vi.fn(), once: vi.fn(), killed: false };
    const spawn = vi.fn().mockReturnValue(child);
    const fetch = vi.fn().mockResolvedValue(response());
    const manager = createTradingBridgeManager({
      spawn,
      fetch,
      randomBytes: () => Buffer.alloc(32, 7),
      delay: vi.fn().mockResolvedValue(undefined),
      pythonExecutable: 'python.exe',
      bridgeRoot: 'C:/bridge',
      port: 18765,
      parentEnv: { SAFE_PARENT_VALUE: 'yes', TRADING_BRIDGE_TOKEN: 'must-not-reuse' },
    });

    await manager.start();

    expect(spawn).toHaveBeenCalledWith('python.exe', ['-m', 'trading_bridge.app'], expect.objectContaining({
      cwd: 'C:/bridge',
      windowsHide: true,
      env: expect.objectContaining({
        SAFE_PARENT_VALUE: 'yes', TRADING_BRIDGE_HOST: '127.0.0.1',
        TRADING_BRIDGE_PORT: '18765', TRADING_BRIDGE_TOKEN: Buffer.alloc(32, 7).toString('hex'),
      }),
    }));
    expect(manager.publicStatus()).toEqual(expect.objectContaining({ state: 'ready', port: 18765 }));
    expect(manager.publicStatus()).not.toHaveProperty('token');
    expect(JSON.stringify(manager.publicStatus())).not.toContain(Buffer.alloc(32, 7).toString('hex'));
  });

  it('keeps the token inside authenticated bridge requests', async () => {
    const token = Buffer.alloc(32, 9).toString('hex');
    const fetch = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({ safe_for_shadow: false }));
    const manager = createTradingBridgeManager({
      spawn: vi.fn().mockReturnValue({ kill: vi.fn(), once: vi.fn(), killed: false }),
      fetch,
      randomBytes: () => Buffer.alloc(32, 9), delay: vi.fn(),
      pythonExecutable: 'python.exe', bridgeRoot: 'C:/bridge', port: 18765, parentEnv: {},
    });
    await manager.start();

    const probe = await manager.runEastmoneyProbe();
    expect(probe).toMatchObject({ safeForShadow: false });

    expect(fetch).toHaveBeenLastCalledWith('http://127.0.0.1:18765/v1/eastmoney/probe', expect.objectContaining({
      method: 'POST', headers: { 'X-Bridge-Token': token, 'Content-Type': 'application/json' },
    }));
  });

  it('kills the child process on stop', async () => {
    const child = { kill: vi.fn(), once: vi.fn(), killed: false };
    const manager = createTradingBridgeManager({
      spawn: vi.fn().mockReturnValue(child), fetch: vi.fn().mockResolvedValue(response()),
      randomBytes: () => Buffer.alloc(32, 1), delay: vi.fn(),
      pythonExecutable: 'python.exe', bridgeRoot: 'C:/bridge', port: 18765, parentEnv: {},
    });
    await manager.start();
    await manager.stop();
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(manager.publicStatus()).toMatchObject({ state: 'stopped' });
  });

  it('reads only approved account fields through the authenticated bridge', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce(response({
        mode: 'eastmoney_read_only',
        source: 'eastmoney_windows_ocr',
        available: true,
        captured_at: '2026-08-17T01:30:00Z',
        quality: 'verified_by_rules',
        verification_required: false,
        available_cash: 1234.56,
        total_assets: 7000,
        positions: [{ code: '000333', total_shares: 300, available_shares: 200 }],
        failure_reason: null,
        raw_ocr: 'must-not-pass',
      }));
    const manager = createTradingBridgeManager({
      spawn: vi.fn().mockReturnValue({ kill: vi.fn(), once: vi.fn(), killed: false }),
      fetch,
      randomBytes: () => Buffer.alloc(32, 5), delay: vi.fn(),
      pythonExecutable: 'python.exe', bridgeRoot: 'C:/bridge', port: 18765, parentEnv: {},
    });
    await manager.start();

    const account = await manager.readEastmoneyAccount();

    expect(account).toEqual({
      mode: 'eastmoney_read_only',
      source: 'eastmoney_windows_ocr',
      available: true,
      capturedAt: '2026-08-17T01:30:00Z',
      quality: 'verified_by_rules',
      verificationRequired: false,
      availableCash: 1234.56,
      totalAssets: 7000,
      positions: [{ code: '000333', totalShares: 300, availableShares: 200 }],
      failureReason: null,
    });
    expect(account).not.toHaveProperty('raw_ocr');
    expect(fetch).toHaveBeenLastCalledWith(
      'http://127.0.0.1:18765/v1/account',
      expect.objectContaining({
        headers: {
          'X-Bridge-Token': Buffer.alloc(32, 5).toString('hex'),
          'Content-Type': 'application/json',
        },
      }),
    );
  });
});

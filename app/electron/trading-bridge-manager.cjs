const { spawn: nodeSpawn } = require('node:child_process');
const { randomBytes: nodeRandomBytes } = require('node:crypto');

const LOOPBACK_HOST = '127.0.0.1';

function createTradingBridgeManager(overrides = {}) {
  const spawn = overrides.spawn || nodeSpawn;
  const fetchImpl = overrides.fetch || globalThis.fetch;
  const randomBytes = overrides.randomBytes || nodeRandomBytes;
  const delay = overrides.delay || ((milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const pythonExecutable = overrides.pythonExecutable;
  const bridgeRoot = overrides.bridgeRoot;
  const port = overrides.port || 8765;
  const parentEnv = overrides.parentEnv || process.env;
  let child = null;
  let token = null;
  let state = 'stopped';
  let lastError = null;

  const baseUrl = `http://${LOOPBACK_HOST}:${port}`;

  async function request(path, options = {}) {
    if (!token || state !== 'ready') throw new Error('trading_bridge_not_ready');
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...options,
      headers: {
        'X-Bridge-Token': token,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`trading_bridge_http_${response.status}`);
    return response.json();
  }

  async function waitUntilHealthy() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        const response = await fetchImpl(`${baseUrl}/health`, {
          headers: { 'X-Bridge-Token': token },
        });
        if (response.ok) return;
      } catch {
        // The child may still be importing Windows libraries.
      }
      await delay(250);
    }
    throw new Error('trading_bridge_start_timeout');
  }

  return {
    async start() {
      if (state === 'ready') return;
      if (!pythonExecutable || !bridgeRoot) throw new Error('trading_bridge_paths_required');
      state = 'starting';
      lastError = null;
      token = randomBytes(32).toString('hex');
      child = spawn(pythonExecutable, ['-m', 'trading_bridge.app'], {
        cwd: bridgeRoot,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...parentEnv,
          TRADING_BRIDGE_HOST: LOOPBACK_HOST,
          TRADING_BRIDGE_PORT: String(port),
          TRADING_BRIDGE_TOKEN: token,
        },
      });
      child.once?.('exit', () => {
        child = null;
        token = null;
        if (state !== 'stopped') state = 'failed';
      });
      try {
        await waitUntilHealthy();
        state = 'ready';
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'trading_bridge_start_failed';
        child?.kill();
        child = null;
        token = null;
        state = 'failed';
        throw error;
      }
    },
    async stop() {
      state = 'stopped';
      if (child && !child.killed) child.kill();
      child = null;
      token = null;
    },
    publicStatus() {
      return { state, port, lastError };
    },
    async runEastmoneyProbe() {
      const raw = await request('/v1/eastmoney/probe', { method: 'POST' });
      return {
        processDetected: raw.process_detected,
        executablePathHash: raw.executable_path_hash,
        productVersion: raw.product_version,
        windowDetected: raw.window_detected,
        loginStateReadable: raw.login_state_readable,
        fundsViewReadable: raw.funds_view_readable,
        positionsViewReadable: raw.positions_view_readable,
        ordersViewReadable: raw.orders_view_readable,
        cancelControlReadable: raw.cancel_control_readable,
        unknownDialogs: raw.unknown_dialogs || [],
        evidence: raw.redacted_evidence || [],
        safeForShadow: raw.safe_for_shadow,
        safeForLive: false,
        probedAt: new Date().toISOString(),
      };
    },
    submitShadowOrder(order) {
      return request('/v1/orders/shadow', { method: 'POST', body: JSON.stringify(order) });
    },
    cancelShadowOrder(orderId) {
      return request(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, { method: 'POST' });
    },
  };
}

module.exports = { createTradingBridgeManager };

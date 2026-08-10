import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { readWorkerConfig } from './config';
import { createNodeMarketDataProvider } from './market-data-provider';
import { createWorkerRuntimeRepository } from './runtime-repository';
import { runTradingScheduler, type TradingSchedulerDependencies } from './scheduler';
import { createWorkerSignalEvaluator } from './signal-evaluator';
import { runStatefulScan } from './stateful-scan-runner';
import { createWorkerRepository } from './supabase-repository';

export interface RunWorkerDependencies {
  repository: Pick<TradingSchedulerDependencies, 'claimLease' | 'writeHeartbeat'>;
  scan: () => Promise<void>;
  cadenceMs: number;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  shouldStop: () => boolean;
}

export function runWorker(deps: RunWorkerDependencies): Promise<void> {
  return runTradingScheduler({
    cadenceMs: deps.cadenceMs,
    now: deps.now,
    sleep: deps.sleep,
    claimLease: deps.repository.claimLease,
    runScan: deps.scan,
    writeHeartbeat: deps.repository.writeHeartbeat,
    shouldStop: deps.shouldStop,
  });
}

async function main(): Promise<void> {
  const config = readWorkerConfig(process.env);
  const client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const assignmentRepository = createWorkerRepository(client as never);
  const repository = createWorkerRuntimeRepository(client, {
    workerName: 'cloud-signal-monitor',
    ownerId: config.workerInstanceId,
    workerVersion: '1',
    assignmentRepository,
  });
  const marketData = createNodeMarketDataProvider();
  const evaluate = createWorkerSignalEvaluator({ marketData });
  let stopping = false;
  const requestStop = () => { stopping = true; };
  process.once('SIGINT', requestStop);
  process.once('SIGTERM', requestStop);

  await runWorker({
    repository,
    cadenceMs: config.scanCadenceMs,
    now: () => new Date(),
    sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    shouldStop: () => stopping,
    scan: async () => {
      await runStatefulScan({ repository, marketData, evaluate });
    },
  });
}

const executedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === executedPath) {
  main().catch(error => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

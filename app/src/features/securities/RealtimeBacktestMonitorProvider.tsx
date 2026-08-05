import { createContext, useContext, type ReactNode } from 'react';
import {
  useRealtimeBacktestMonitor,
  type UseRealtimeBacktestMonitorResult,
} from './useRealtimeBacktestMonitor';

const RealtimeBacktestMonitorContext = createContext<UseRealtimeBacktestMonitorResult | null>(null);

export interface RealtimeBacktestMonitorProviderProps {
  children: ReactNode;
}

export function RealtimeBacktestMonitorProvider({ children }: RealtimeBacktestMonitorProviderProps) {
  const monitor = useRealtimeBacktestMonitor();
  return (
    <RealtimeBacktestMonitorContext.Provider value={monitor}>
      {children}
    </RealtimeBacktestMonitorContext.Provider>
  );
}

export function useRealtimeBacktestMonitorContext(): UseRealtimeBacktestMonitorResult {
  const monitor = useContext(RealtimeBacktestMonitorContext);
  if (!monitor) {
    throw new Error('useRealtimeBacktestMonitorContext必须在RealtimeBacktestMonitorProvider内使用');
  }
  return monitor;
}

export interface WorkerStrategyAssignment {
  strategyId: string;
  strategyVersion: string;
  config: Record<string, unknown>;
}

export interface UserMonitoringAssignment {
  userId: string;
  watchlistCodes: string[];
  actualPositionCodes: string[];
  virtualPositionCodes: string[];
  strategies: WorkerStrategyAssignment[];
}

export interface UserMonitoringProjection extends UserMonitoringAssignment {
  allCodes: string[];
}

export interface GlobalMonitoringUniverse {
  codes: string[];
  byUser: Map<string, UserMonitoringProjection>;
}

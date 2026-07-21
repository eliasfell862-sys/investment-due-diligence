export interface EvidenceConflictCandidate {
  readonly id: string;
  readonly projectId: string;
  readonly fieldId: string;
  readonly normalizedValue: string;
}

export interface EvidenceItem extends EvidenceConflictCandidate {
  readonly sourceDocumentId?: string;
  readonly sourceLocator?: string;
  readonly rawValue: string;
  readonly confidence: number;
  readonly conflictStatus: 'none' | 'unresolved' | 'resolved';
  readonly updatedAt: string;
}

export interface ConflictResolution {
  readonly status: 'missing' | 'invalid' | 'agreed' | 'provisional' | 'blocked';
  readonly analysisValue: string | null;
  readonly selectedEvidenceId: string | null;
  readonly requiresConfirmation: boolean;
  readonly blocksConclusion: boolean;
}

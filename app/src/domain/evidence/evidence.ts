export interface EvidenceItem {
  id: string;
  projectId: string;
  fieldId: string;
  sourceDocumentId?: string;
  sourceLocator?: string;
  rawValue: string;
  normalizedValue: string;
  confidence: number;
  conflictStatus: 'none' | 'unresolved' | 'resolved';
  updatedAt: string;
}

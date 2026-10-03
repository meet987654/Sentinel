import { BreakingChange } from '../types.js';

export interface EndpointFilterOptions {
  includeExactMatchesOnly?: boolean;
  additionalKeywords?: string[];
}

export interface FilterCandidateResult {
  candidateFiles: string[];
  skippedFiles: string[];
  targetRoutes: string[];
  targetProperties: string[];
  stats: {
    totalFiles: number;
    candidateCount: number;
    filteredOutCount: number;
    filterRatio: number;
  };
}

export interface SourceFileContent {
  filePath: string;
  content: string;
}

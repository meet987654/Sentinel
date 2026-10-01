import { Project, SourceFile, SyntaxKind } from 'ts-morph';

export interface FileImportRecord {
  moduleSpecifier: string;
  namedImports: string[];
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly: boolean;
}

export interface DependencyIndex {
  version: string;
  generatedAt: string;
  repository?: string;
  totalFiles: number;
  typeToFiles: Record<string, string[]>;
  routeToFiles: Record<string, string[]>;
  symbolToFiles: Record<string, string[]>;
  fileImports: Record<string, FileImportRecord[]>;
}

export interface IndexerOptions {
  repositoryName?: string;
  ignorePaths?: string[];
}

export const DEPENDENCY_INDEX_VERSION = '1.0.0';

import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import { shouldIgnoreFile } from '../config.js';

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

/**
 * Builds a fast Symbol & Dependency Index from a ts-morph Project,
 * mapping imported types, symbols, routes, and import declarations to file paths.
 */
export function buildDependencyIndex(project: Project, options?: IndexerOptions): DependencyIndex {
  const typeToFiles: Record<string, string[]> = {};
  const routeToFiles: Record<string, string[]> = {};
  const symbolToFiles: Record<string, string[]> = {};
  const fileImports: Record<string, FileImportRecord[]> = {};

  const sourceFiles = project.getSourceFiles();
  let indexedFileCount = 0;

  for (const sourceFile of sourceFiles) {
    const rawPath = sourceFile.getFilePath();
    const filePath = rawPath.replace(/\\/g, '/');

    if (options?.ignorePaths && shouldIgnoreFile(filePath, options.ignorePaths)) {
      continue;
    }

    indexedFileCount++;
    const fileImportRecords: FileImportRecord[] = [];

    // 1. Process ImportDeclarations
    const importDeclarations = sourceFile.getImportDeclarations();
    for (const importDecl of importDeclarations) {
      const moduleSpecifier = importDecl.getModuleSpecifierValue();
      const isTypeOnly = importDecl.isTypeOnly();
      const namedImports: string[] = [];

      for (const named of importDecl.getNamedImports()) {
        const name = named.getName();
        namedImports.push(name);

        if (!symbolToFiles[name]) symbolToFiles[name] = [];
        if (!symbolToFiles[name].includes(filePath)) symbolToFiles[name].push(filePath);

        if (named.isTypeOnly() || isTypeOnly || /^[A-Z]/.test(name)) {
          if (!typeToFiles[name]) typeToFiles[name] = [];
          if (!typeToFiles[name].includes(filePath)) typeToFiles[name].push(filePath);
        }
      }

      const defaultImport = importDecl.getDefaultImport()?.getText();
      if (defaultImport) {
        if (!symbolToFiles[defaultImport]) symbolToFiles[defaultImport] = [];
        if (!symbolToFiles[defaultImport].includes(filePath)) symbolToFiles[defaultImport].push(filePath);
      }

      const namespaceImport = importDecl.getNamespaceImport()?.getText();
      if (namespaceImport) {
        if (!symbolToFiles[namespaceImport]) symbolToFiles[namespaceImport] = [];
        if (!symbolToFiles[namespaceImport].includes(filePath)) symbolToFiles[namespaceImport].push(filePath);
      }

      fileImportRecords.push({
        moduleSpecifier,
        namedImports,
        defaultImport,
        namespaceImport,
        isTypeOnly,
      });
    }

    fileImports[filePath] = fileImportRecords;

    // 2. Scan string literals for API route patterns
    const stringLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.StringLiteral);
    for (const strLit of stringLiterals) {
      const text = strLit.getLiteralValue();
      if (text.startsWith('/') && text.length > 1 && !text.includes('\n')) {
        const route = text.trim();
        if (!routeToFiles[route]) routeToFiles[route] = [];
        if (!routeToFiles[route].includes(filePath)) routeToFiles[route].push(filePath);
      }
    }

    // 3. Scan template literals for static routes
    const templateLiterals = sourceFile.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral);
    for (const tpl of templateLiterals) {
      const text = tpl.getLiteralValue();
      if (text.startsWith('/') && text.length > 1 && !text.includes('\n')) {
        const route = text.trim();
        if (!routeToFiles[route]) routeToFiles[route] = [];
        if (!routeToFiles[route].includes(filePath)) routeToFiles[route].push(filePath);
      }
    }
  }

  return {
    version: DEPENDENCY_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    repository: options?.repositoryName,
    totalFiles: indexedFileCount,
    typeToFiles,
    routeToFiles,
    symbolToFiles,
    fileImports,
  };
}


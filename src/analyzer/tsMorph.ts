import { Project, SyntaxKind, PropertyAccessExpression } from 'ts-morph';
import { BreakingChange, ConsumerFinding } from '../types.js';

export function analyzeConsumers(
  workspaceDir: string,
  changes: BreakingChange[]
): ConsumerFinding[] {
  const project = new Project();
  project.addSourceFilesAtPaths(`${workspaceDir}/**/*.ts`);
  project.addSourceFilesAtPaths(`${workspaceDir}/**/*.tsx`);

  return analyzeConsumersFromProject(project, changes);
}

export function analyzeConsumersFromProject(
  project: Project,
  changes: BreakingChange[]
): ConsumerFinding[] {
  const findings: ConsumerFinding[] = [];

  const propertyNamesToFind = new Map<string, string>();
  for (const change of changes) {
    if (change.type === 'FIELD_REMOVED' || change.type === 'TYPE_CHANGED') {
      const parts = change.path.split('.');
      const propertyName = parts[parts.length - 1];
      
      if (propertyName !== '[]' && isNaN(parseInt(propertyName, 10))) {
        propertyNamesToFind.set(propertyName, change.path);
      }
    }
  }

  if (propertyNamesToFind.size === 0) {
    return findings;
  }

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes('node_modules') || sourceFile.getFilePath().includes('dist')) {
      continue;
    }

    const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);

    for (const access of propertyAccesses) {
      const propName = access.getName();

      if (propertyNamesToFind.has(propName)) {
        const schemaPath = propertyNamesToFind.get(propName) || '';
        const line = sourceFile.getLineAndColumnAtPos(access.getStart()).line;
        const lineText = sourceFile.getFullText().split('\n')[line - 1].trim();
        const relativePath = sourceFile.getFilePath().replace(/^[\/\\]/, '');

        const confidence = resolveSymbolConfidence(access, schemaPath);

        findings.push({
          confidence,
          filePath: relativePath,
          lineNumber: line,
          snippet: lineText,
          property: propName,
        });
      }
    }
  }

  return findings;
}

function resolveSymbolConfidence(
  access: PropertyAccessExpression,
  schemaPath: string
): 'confirmed' | 'high' | 'medium' {
  try {
    const expr = access.getExpression();
    const exprType = expr.getType();

    // Untyped expressions (any / unknown) cannot be symbol-confirmed
    if (exprType.isAny() || exprType.isUnknown()) {
      return 'medium';
    }

    const symbol = exprType.getSymbol() || exprType.getAliasSymbol();
    if (!symbol) {
      return 'medium';
    }

    const symbolName = symbol.getName().toLowerCase();
    
    // Extract schema path keywords (e.g. "GET /users.response.200.email" -> ["users", "email"])
    const pathKeywords = schemaPath
      .toLowerCase()
      .split(/[\/\.\s_]+/)
      .filter(k => k && k !== 'response' && k !== 'get' && k !== 'post' && k !== 'put' && k !== 'delete' && k !== '200');

    // Check if the symbol name matches keywords from the OpenAPI schema path
    const isSymbolMatch = pathKeywords.some(keyword => {
      if (keyword.length <= 2) return false;
      const singular = keyword.endsWith('s') ? keyword.slice(0, -1) : keyword;
      return symbolName.includes(keyword) || symbolName.includes(singular);
    });

    if (isSymbolMatch) {
      return 'confirmed';
    }

    // Check if symbol belongs to a declared Interface, TypeAlias, or Class in the project
    const declarations = symbol.getDeclarations();
    const hasInterfaceOrTypeDecl = declarations.some(
      decl =>
        decl.getKind() === SyntaxKind.InterfaceDeclaration ||
        decl.getKind() === SyntaxKind.TypeAliasDeclaration ||
        decl.getKind() === SyntaxKind.ClassDeclaration
    );

    if (hasInterfaceOrTypeDecl) {
      return 'confirmed';
    }

    return 'high';
  } catch {
    return 'medium';
  }
}

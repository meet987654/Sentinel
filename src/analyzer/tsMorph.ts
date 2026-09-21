import { Project, SyntaxKind, PropertyAccessExpression, BindingElement } from 'ts-morph';
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

    const relativePath = sourceFile.getFilePath().replace(/^[\/\\]/, '');
    const seen = new Set<string>();

    // 1. Scan PropertyAccessExpressions (e.g. user.university)
    const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);

    for (const access of propertyAccesses) {
      const propName = access.getName();

      if (propertyNamesToFind.has(propName)) {
        const schemaPath = propertyNamesToFind.get(propName) || '';
        const line = sourceFile.getLineAndColumnAtPos(access.getStart()).line;
        const lineText = sourceFile.getFullText().split('\n')[line - 1].trim();
        const key = `${relativePath}:${line}:${propName}`;

        if (!seen.has(key)) {
          seen.add(key);
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

    // 2. Scan BindingElements for destructuring (e.g. const { university } = user)
    const bindingElements = sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement);

    for (const element of bindingElements) {
      const propName = element.getPropertyNameNode()?.getText() || element.getName();

      if (propertyNamesToFind.has(propName)) {
        const schemaPath = propertyNamesToFind.get(propName) || '';
        const line = sourceFile.getLineAndColumnAtPos(element.getStart()).line;
        const lineText = sourceFile.getFullText().split('\n')[line - 1].trim();
        const key = `${relativePath}:${line}:${propName}`;

        if (!seen.has(key)) {
          seen.add(key);
          const confidence = resolveBindingElementConfidence(element, schemaPath);

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

    if (exprType.isAny() || exprType.isUnknown()) {
      return 'medium';
    }

    const symbol = exprType.getSymbol() || exprType.getAliasSymbol();
    if (!symbol) {
      return 'medium';
    }

    const symbolName = symbol.getName().toLowerCase();
    const pathKeywords = schemaPath
      .toLowerCase()
      .split(/[\/\.\s_]+/)
      .filter(k => k && k !== 'response' && k !== 'get' && k !== 'post' && k !== 'put' && k !== 'delete' && k !== '200');

    const isSymbolMatch = pathKeywords.some(keyword => {
      if (keyword.length <= 2) return false;
      const singular = keyword.endsWith('s') ? keyword.slice(0, -1) : keyword;
      return symbolName.includes(keyword) || symbolName.includes(singular);
    });

    if (isSymbolMatch) {
      return 'confirmed';
    }

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

function resolveBindingElementConfidence(
  element: BindingElement,
  schemaPath: string
): 'confirmed' | 'high' | 'medium' {
  try {
    const ancestor = element.getFirstAncestor(
      node =>
        node.getKind() === SyntaxKind.VariableDeclaration ||
        node.getKind() === SyntaxKind.Parameter
    );

    if (!ancestor) {
      return 'medium';
    }

    const pathKeywords = schemaPath
      .toLowerCase()
      .split(/[\/\.\s_]+/)
      .filter(k => k && k !== 'response' && k !== 'get' && k !== 'post' && k !== 'put' && k !== 'delete' && k !== '200');

    let targetType;
    let typeNodeText = '';

    if (ancestor.getKind() === SyntaxKind.VariableDeclaration) {
      const varDecl = ancestor.asKind(SyntaxKind.VariableDeclaration);
      const initializer = varDecl?.getInitializer();
      if (initializer) {
        targetType = initializer.getType();
      } else {
        targetType = varDecl?.getTypeNode()?.getType() || varDecl?.getType();
      }
      typeNodeText = varDecl?.getTypeNode()?.getText() || '';
    } else if (ancestor.getKind() === SyntaxKind.Parameter) {
      const paramDecl = ancestor.asKind(SyntaxKind.Parameter);
      targetType = paramDecl?.getTypeNode()?.getType() || paramDecl?.getType();
      typeNodeText = paramDecl?.getTypeNode()?.getText() || '';
    }

    if (typeNodeText) {
      const typeTextLower = typeNodeText.toLowerCase();
      const isTypeNodeMatch = pathKeywords.some(keyword => {
        if (keyword.length <= 2) return false;
        const singular = keyword.endsWith('s') ? keyword.slice(0, -1) : keyword;
        return typeTextLower.includes(keyword) || typeTextLower.includes(singular);
      });
      if (isTypeNodeMatch) {
        return 'confirmed';
      }
    }

    if (!targetType || targetType.isAny() || targetType.isUnknown()) {
      return typeNodeText ? 'high' : 'medium';
    }

    const symbol = targetType.getSymbol() || targetType.getAliasSymbol();
    if (!symbol) {
      return typeNodeText ? 'high' : 'medium';
    }

    const symbolName = symbol.getName().toLowerCase();
    const isSymbolMatch = pathKeywords.some(keyword => {
      if (keyword.length <= 2) return false;
      const singular = keyword.endsWith('s') ? keyword.slice(0, -1) : keyword;
      return symbolName.includes(keyword) || symbolName.includes(singular);
    });

    if (isSymbolMatch) {
      return 'confirmed';
    }

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

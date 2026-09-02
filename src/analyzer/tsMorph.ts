import { Project, SyntaxKind } from 'ts-morph';
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
        const line = sourceFile.getLineAndColumnAtPos(access.getStart()).line;
        const lineText = sourceFile.getFullText().split('\n')[line - 1].trim();
        const relativePath = sourceFile.getFilePath().replace(/^[\/\\]/, '');

        findings.push({
          confidence: 'medium',
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

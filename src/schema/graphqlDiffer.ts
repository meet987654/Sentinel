import { BreakingChange, ConsumerFinding } from '../types.js';
import {
  buildSchema,
  findBreakingChanges,
  findDangerousChanges,
  BreakingChange as GqlBreakingChange,
  DangerousChange as GqlDangerousChange,
  GraphQLSchema,
  parse,
  visit,
} from 'graphql';

export interface GraphQLBreakingChange extends BreakingChange {
  protocol: 'graphql';
  typeName?: string;
  fieldName?: string;
  argName?: string;
}

export interface GraphQLDiffOptions {
  includeWarnings?: boolean;
}

export interface GraphQLSourceDocument {
  filePath: string;
  content: string;
}

/**
 * Normalizes raw GraphQL breaking and dangerous changes into Sentinel BreakingChange models.
 */
function parseGraphQLChange(
  change: GqlBreakingChange | GqlDangerousChange,
  severity: 'breaking' | 'warning'
): GraphQLBreakingChange {
  const desc = change.description;
  let typeName = '';
  let fieldName = '';
  let argName = '';
  let oldValue: unknown = undefined;
  let newValue: unknown = undefined;
  let path = desc;
  let changeType: BreakingChange['type'] = severity === 'breaking' ? 'GRAPHQL_FIELD_REMOVED' : 'FIELD_REMOVED';

  // 1. Field removal: "Field User.name was removed."
  const fieldRemovedMatch = desc.match(/^Field\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s+was removed/i);
  if (fieldRemovedMatch) {
    typeName = fieldRemovedMatch[1];
    fieldName = fieldRemovedMatch[2];
    path = `${typeName}.${fieldName}`;
    changeType = 'GRAPHQL_FIELD_REMOVED';
  }

  // 2. Field type changed: "Field User.name changed type from String to Int."
  const fieldTypeMatch = desc.match(
    /^Field\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s+changed type from\s+(.+?)\s+to\s+(.+?)\./i
  );
  if (fieldTypeMatch) {
    typeName = fieldTypeMatch[1];
    fieldName = fieldTypeMatch[2];
    oldValue = fieldTypeMatch[3];
    newValue = fieldTypeMatch[4];
    path = `${typeName}.${fieldName}`;
    changeType = 'GRAPHQL_TYPE_CHANGED';
  }

  // 3. Required argument added: "A required argument Query.user(orgId:) was added."
  const reqArgMatch = desc.match(
    /^A required argument\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\(([A-Za-z0-9_]+):?\)\s+was added/i
  );
  if (reqArgMatch) {
    typeName = reqArgMatch[1];
    fieldName = reqArgMatch[2];
    argName = reqArgMatch[3];
    path = `${typeName}.${fieldName}(${argName})`;
    changeType = 'GRAPHQL_ARG_REQUIRED';
  }

  // 4. Type removed: "Type Admin was removed."
  const typeRemovedMatch = desc.match(/^Type\s+([A-Za-z0-9_]+)\s+was removed/i);
  if (typeRemovedMatch) {
    typeName = typeRemovedMatch[1];
    path = typeName;
    changeType = 'GRAPHQL_TYPE_REMOVED';
  }

  // 5. Enum value removed: "Enum value Role.MODERATOR was removed."
  const enumValMatch = desc.match(/^Enum value\s+([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s+was removed/i);
  if (enumValMatch) {
    typeName = enumValMatch[1];
    fieldName = enumValMatch[2];
    path = `${typeName}.${fieldName}`;
    changeType = 'GRAPHQL_FIELD_REMOVED';
  }

  return {
    type: changeType,
    severity,
    path,
    protocol: 'graphql',
    typeName: typeName || undefined,
    fieldName: fieldName || undefined,
    argName: argName || undefined,
    oldValue,
    newValue,
  };
}

/**
 * Compares two GraphQL Schema Definition Language (SDL) strings and returns
 * structured breaking changes (removed types, removed fields, type changes, required args).
 */
export function diffGraphQLSchemas(
  baseSdl: string,
  headSdl: string,
  options?: GraphQLDiffOptions
): BreakingChange[] {
  if (!baseSdl?.trim() || !headSdl?.trim()) {
    return [];
  }

  let baseSchema: GraphQLSchema;
  let headSchema: GraphQLSchema;

  try {
    baseSchema = buildSchema(baseSdl);
    headSchema = buildSchema(headSdl);
  } catch {
    return [];
  }

  const rawBreaking = findBreakingChanges(baseSchema, headSchema);
  const changes: BreakingChange[] = rawBreaking.map(c => parseGraphQLChange(c, 'breaking'));

  if (options?.includeWarnings) {
    const rawWarnings = findDangerousChanges(baseSchema, headSchema);
    for (const w of rawWarnings) {
      changes.push(parseGraphQLChange(w, 'warning'));
    }
  }

  return changes;
}

/**
 * Traces GraphQL breaking changes into consumer source documents
 * scanning for broken field references in queries, mutations, subscriptions,
 * and gql template literals.
 */
export function traceGraphQLConsumerQueries(
  documents: GraphQLSourceDocument[],
  changes: BreakingChange[]
): ConsumerFinding[] {
  const findings: ConsumerFinding[] = [];
  const seenKeys = new Set<string>();

  if (!documents || documents.length === 0 || !changes || changes.length === 0) {
    return [];
  }

  // Extract all target broken fields and properties
  const targetFields = new Set<string>();
  for (const change of changes) {
    const gqlChange = change as GraphQLBreakingChange;
    if (gqlChange.fieldName) {
      targetFields.add(gqlChange.fieldName);
    }
    const pathParts = change.path.split('.');
    const lastPart = pathParts[pathParts.length - 1].replace(/\(.*\)/, '').trim();
    if (lastPart) {
      targetFields.add(lastPart);
    }
  }

  if (targetFields.size === 0) {
    return [];
  }

  for (const doc of documents) {
    const lines = doc.content.split(/\r?\n/);
    const isGqlFile = doc.filePath.endsWith('.graphql') || doc.filePath.endsWith('.gql');

    if (isGqlFile) {
      // 1. Pure GraphQL file: parse whole document AST
      let parsedSuccessfully = false;
      try {
        const ast = parse(doc.content, { noLocation: false });
        parsedSuccessfully = true;

        visit(ast, {
          Field(node) {
            const fieldName = node.name.value;
            if (targetFields.has(fieldName)) {
              const startOffset = node.loc ? node.loc.start : 0;
              const lineNumber = doc.content.substring(0, startOffset).split(/\r?\n/).length;
              const key = `${doc.filePath}:${lineNumber}:${fieldName}`;

              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                findings.push({
                  confidence: 'confirmed',
                  filePath: doc.filePath,
                  lineNumber,
                  snippet: lines[lineNumber - 1]?.trim() || fieldName,
                  property: fieldName,
                });
              }
            }
          },
        });
      } catch {
        parsedSuccessfully = false;
      }

      // Fallback for partial/invalid GraphQL documents: line-by-line regex scanning
      if (!parsedSuccessfully) {
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          for (const field of targetFields) {
            const fieldRegex = new RegExp(`\\b${field}\\b`);
            if (fieldRegex.test(line)) {
              const lineNumber = i + 1;
              const key = `${doc.filePath}:${lineNumber}:${field}`;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                findings.push({
                  confidence: 'high',
                  filePath: doc.filePath,
                  lineNumber,
                  snippet: line.trim(),
                  property: field,
                });
              }
            }
          }
        }
      }
    } else {
      // 2. JS/TS/JSX file: extract gql`...` or graphql`...` tagged template literals
      const templateRegex = /(?:gql|graphql)\s*`([\s\S]*?)`/g;
      let match: RegExpExecArray | null;

      while ((match = templateRegex.exec(doc.content)) !== null) {
        const templateQuery = match[1];
        const backtickOffset = match.index + match[0].indexOf('`') + 1;

        try {
          const ast = parse(templateQuery, { noLocation: false });
          visit(ast, {
            Field(node) {
              const fieldName = node.name.value;
              if (targetFields.has(fieldName)) {
                const charOffsetInFile = backtickOffset + (node.loc ? node.loc.start : 0);
                const lineNumber = doc.content.substring(0, charOffsetInFile).split(/\r?\n/).length;
                const key = `${doc.filePath}:${lineNumber}:${fieldName}`;

                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  findings.push({
                    confidence: 'confirmed',
                    filePath: doc.filePath,
                    lineNumber,
                    snippet: lines[lineNumber - 1]?.trim() || fieldName,
                    property: fieldName,
                  });
                }
              }
            },
          });
        } catch {
          // If AST parse of the template fails, scan lines within template for keywords
          const templateLines = templateQuery.split(/\r?\n/);
          const templateStartLine = doc.content.substring(0, backtickOffset).split(/\r?\n/).length;

          for (let ti = 0; ti < templateLines.length; ti++) {
            const tLine = templateLines[ti];
            for (const field of targetFields) {
              const fieldRegex = new RegExp(`\\b${field}\\b`);
              if (fieldRegex.test(tLine)) {
                const lineNumber = templateStartLine + ti;
                const key = `${doc.filePath}:${lineNumber}:${field}`;
                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  findings.push({
                    confidence: 'high',
                    filePath: doc.filePath,
                    lineNumber,
                    snippet: lines[lineNumber - 1]?.trim() || tLine.trim(),
                    property: field,
                  });
                }
              }
            }
          }
        }
      }

      // Also scan plain GraphQL query strings inside TypeScript files (e.g. `const query = "query { user { name } }";`)
      const queryStringRegex = /['"](?:query|mutation|subscription)\b[\s\S]*?['"]/g;
      let strMatch: RegExpExecArray | null;
      while ((strMatch = queryStringRegex.exec(doc.content)) !== null) {
        const strContent = strMatch[0];
        for (const field of targetFields) {
          const fieldRegex = new RegExp(`\\b${field}\\b`);
          if (fieldRegex.test(strContent)) {
            const charOffset = strMatch.index;
            const lineNumber = doc.content.substring(0, charOffset).split(/\r?\n/).length;
            const key = `${doc.filePath}:${lineNumber}:${field}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              findings.push({
                confidence: 'high',
                filePath: doc.filePath,
                lineNumber,
                snippet: lines[lineNumber - 1]?.trim() || field,
                property: field,
              });
            }
          }
        }
      }
    }
  }

  return findings;
}

import { BreakingChange, ConsumerFinding } from '../types.js';
import {
  buildSchema,
  findBreakingChanges,
  findDangerousChanges,
  BreakingChange as GqlBreakingChange,
  DangerousChange as GqlDangerousChange,
  GraphQLSchema,
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
  // Scaffolding: Implementation will be populated in next commit
  return [];
}

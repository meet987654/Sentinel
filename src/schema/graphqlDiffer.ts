import { BreakingChange, ConsumerFinding } from '../types.js';

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
 * Compares two GraphQL Schema Definition Language (SDL) strings and returns
 * structured breaking changes (removed types, removed fields, type changes, required args).
 */
export function diffGraphQLSchemas(
  baseSdl: string,
  headSdl: string,
  options?: GraphQLDiffOptions
): BreakingChange[] {
  // Scaffolding: Implementation will be populated in subsequent commits
  return [];
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
  // Scaffolding: Implementation will be populated in subsequent commits
  return [];
}

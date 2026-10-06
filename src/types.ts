export interface ApiSchema {
  endpoints: Map<string, Endpoint>;
}

export interface Endpoint {
  path: string;
  method: string;
  parameters: Parameter[];
  requestBody?: SchemaNode;
  responses: Map<number, SchemaNode>;
}

export interface Parameter {
  name: string;
  in: 'query' | 'header' | 'path' | 'cookie';
  required: boolean;
  schema?: SchemaNode;
}

export interface SchemaNode {
  type: string;
  properties?: Map<string, SchemaNode>;
  required: Set<string>;
  items?: SchemaNode;
  nullable?: boolean;
  oneOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  allOf?: SchemaNode[];
}

export type BreakingChangeType =
  | 'ENDPOINT_REMOVED'
  | 'FIELD_REMOVED'
  | 'TYPE_CHANGED'
  | 'OPTIONAL_TO_REQUIRED'
  | 'VARIANT_REMOVED'
  | 'NULLABLE_REMOVED'
  | 'GRAPHQL_FIELD_REMOVED'
  | 'GRAPHQL_TYPE_CHANGED'
  | 'GRAPHQL_ARG_REQUIRED'
  | 'GRAPHQL_TYPE_REMOVED'
  | 'PROTO_FIELD_REMOVED'
  | 'PROTO_FIELD_TAG_CHANGED'
  | 'PROTO_FIELD_TYPE_CHANGED'
  | 'PROTO_FIELD_RULE_CHANGED'
  | 'PROTO_MESSAGE_REMOVED'
  | 'PROTO_METHOD_REMOVED'
  | 'PROTO_ENUM_VALUE_REMOVED';

export interface BreakingChange {
  type: BreakingChangeType;
  severity: 'breaking' | 'warning' | 'safe';
  path: string; // e.g. "/users/{id}.GET.response.email" or "Query.user.email"
  oldValue?: unknown;
  newValue?: unknown;
  protocol?: 'openapi' | 'graphql' | 'grpc' | 'asyncapi';
}

export interface ConsumerFinding {
  confidence: 'confirmed' | 'high' | 'medium';
  filePath: string;
  lineNumber: number;
  snippet: string;
  property: string; // The property accessed, e.g. "email"
  repositoryName?: string; // Optional repository name (e.g. "org/web-frontend" or "web-frontend")
  commitSha?: string; // Optional commit sha for deep links
}

export interface RepoScanStatus {
  repositoryName: string;
  status: 'analyzed' | 'permission_denied' | 'not_installed' | 'error';
  message?: string;
  findingCount?: number;
}

export interface ChangeReport {
  changes: BreakingChange[];
  findings: ConsumerFinding[];
  summary?: string;
  repoStatuses?: RepoScanStatus[];
}

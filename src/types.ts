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

export interface BreakingChange {
  type: 'ENDPOINT_REMOVED' | 'FIELD_REMOVED' | 'TYPE_CHANGED' | 'OPTIONAL_TO_REQUIRED' | 'VARIANT_REMOVED' | 'NULLABLE_REMOVED';
  severity: 'breaking' | 'warning' | 'safe';
  path: string; // e.g. "/users/{id}.GET.response.email"
  oldValue?: unknown;
  newValue?: unknown;
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

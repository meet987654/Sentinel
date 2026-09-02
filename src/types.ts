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
}

export interface BreakingChange {
  type: 'ENDPOINT_REMOVED' | 'FIELD_REMOVED' | 'TYPE_CHANGED' | 'OPTIONAL_TO_REQUIRED';
  severity: 'breaking' | 'warning' | 'safe';
  path: string; // e.g. "/users/{id}.GET.response.email"
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ConsumerFinding {
  confidence: 'high' | 'medium';
  filePath: string;
  lineNumber: number;
  snippet: string;
  property: string; // The property accessed, e.g. "email"
}

export interface ChangeReport {
  changes: BreakingChange[];
  findings: ConsumerFinding[];
  summary?: string;
}

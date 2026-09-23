import SwaggerParser from '@apidevtools/swagger-parser';
import { ApiSchema, Endpoint, Parameter, SchemaNode } from '../types.js';
import { OpenAPIV3 } from 'openapi-types';
import yaml from 'js-yaml';

export async function parseOpenApi(content: string, filePath?: string, resolver?: any): Promise<ApiSchema> {
  const endpoints = new Map<string, Endpoint>();
  if (!content || !content.trim()) {
    return { endpoints };
  }

  // Parse yaml/json string into an object
  let rawObj: any;
  const ext = filePath?.toLowerCase();

  if (ext?.endsWith('.json')) {
    rawObj = JSON.parse(content);
  } else if (ext?.endsWith('.yaml') || ext?.endsWith('.yml')) {
    rawObj = yaml.load(content);
  } else {
    try {
      rawObj = yaml.load(content);
    } catch (err) {
      rawObj = JSON.parse(content);
    }
  }

  if (!rawObj || typeof rawObj !== 'object') {
    return { endpoints };
  }

  // Dereference all $ref pointers so we have a flat, fully resolved object
  let api: OpenAPIV3.Document;
  try {
    if (resolver && filePath) {
      const dummyUrl = `github://internal/${filePath}`;
      // @ts-ignore - Ignoring pre-existing type mismatch with swagger-parser options
      api = (await SwaggerParser.dereference(dummyUrl, rawObj, {
        resolve: {
          github: resolver,
          file: false,
          http: false,
        }
      })) as unknown as OpenAPIV3.Document;
    } else {
      api = (await SwaggerParser.dereference(rawObj)) as OpenAPIV3.Document;
    }
  } catch (err) {
    // If swagger-parser fails on partial/invalid refs, fallback to raw document
    api = rawObj as OpenAPIV3.Document;
  }

  if (!api.paths) return { endpoints };

  for (const [pathStr, pathItem] of Object.entries(api.paths)) {
    if (!pathItem) continue;

    const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
    for (const method of methods) {
      if (method in pathItem) {
        const operation = (pathItem as any)[method] as OpenAPIV3.OperationObject;
        
        const endpointKey = `${method.toUpperCase()} ${pathStr}`;
        const parameters: Parameter[] = [];

        // Add parameters
        if (operation.parameters) {
          for (const param of operation.parameters as OpenAPIV3.ParameterObject[]) {
            parameters.push({
              name: param.name,
              in: param.in as any,
              required: !!param.required,
              schema: param.schema ? mapSchemaNode(param.schema as OpenAPIV3.SchemaObject, new Set(), new Set(), api) : undefined,
            });
          }
        }

        // Add Request Body
        let requestBody: SchemaNode | undefined;
        if (operation.requestBody) {
          const reqBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
          const contentSchema = reqBody.content?.['application/json']?.schema;
          if (contentSchema) {
            requestBody = mapSchemaNode(contentSchema as OpenAPIV3.SchemaObject, new Set(), new Set(), api);
          }
        }

        // Add Responses
        const responses = new Map<number, SchemaNode>();
        if (operation.responses) {
          for (const [statusCode, response] of Object.entries(operation.responses)) {
            const res = response as OpenAPIV3.ResponseObject;
            const contentSchema = res.content?.['application/json']?.schema;
            const parsedStatus = parseInt(statusCode, 10);
            
            if (contentSchema && !isNaN(parsedStatus)) {
              responses.set(parsedStatus, mapSchemaNode(contentSchema as OpenAPIV3.SchemaObject, new Set(), new Set(), api));
            } else if (contentSchema && statusCode === 'default') {
              responses.set(200, mapSchemaNode(contentSchema as OpenAPIV3.SchemaObject, new Set(), new Set(), api));
            }
          }
        }

        endpoints.set(endpointKey, {
          path: pathStr,
          method: method.toUpperCase(),
          parameters,
          requestBody,
          responses,
        });
      }
    }
  }

  return { endpoints };
}

export function mapSchemaNode(
  schema: any,
  visitedSchemas = new Set<any>(),
  visitedRefs = new Set<string>(),
  rootDoc?: any
): SchemaNode {
  if (!schema || typeof schema !== 'object') {
    return { type: 'unknown', required: new Set() };
  }

  // Handle manual $ref pointer resolution if unresolved
  if (schema.$ref && typeof schema.$ref === 'string' && rootDoc) {
    const refStr = schema.$ref;
    if (visitedRefs.has(refStr)) {
      return { type: 'object', required: new Set() };
    }
    visitedRefs.add(refStr);
    const resolved = resolveJsonPointer(refStr, rootDoc);
    if (resolved) {
      const result = mapSchemaNode(resolved, visitedSchemas, visitedRefs, rootDoc);
      visitedRefs.delete(refStr);
      return result;
    }
    visitedRefs.delete(refStr);
  }

  const rawType = Array.isArray(schema.type) ? schema.type[0] : (schema.type || 'object');
  const node: SchemaNode = {
    type: rawType,
    required: new Set<string>(schema.required || []),
  };

  if (visitedSchemas.has(schema)) {
    return node;
  }
  visitedSchemas.add(schema);

  if (schema.properties) {
    node.properties = new Map<string, SchemaNode>();
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      node.properties.set(key, mapSchemaNode(propSchema as OpenAPIV3.SchemaObject, visitedSchemas, visitedRefs, rootDoc));
    }
  }

  if ('items' in schema && schema.items) {
    node.items = mapSchemaNode(schema.items as OpenAPIV3.SchemaObject, visitedSchemas, visitedRefs, rootDoc);
  }

  visitedSchemas.delete(schema);
  return node;
}

export function resolveJsonPointer(pointer: string, doc: any): any {
  if (!pointer || !pointer.startsWith('#/')) {
    return undefined;
  }
  const parts = pointer.substring(2).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let current = doc;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

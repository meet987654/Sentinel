import SwaggerParser from '@apidevtools/swagger-parser';
import { ApiSchema, Endpoint, Parameter, SchemaNode } from '../types.js';
import { OpenAPIV3 } from 'openapi-types';
import yaml from 'js-yaml';

export async function parseOpenApi(content: string): Promise<ApiSchema> {
  // Parse yaml/json string into an object
  let rawObj: any;
  try {
    rawObj = yaml.load(content);
  } catch (err) {
    rawObj = JSON.parse(content);
  }

  // Dereference all $ref pointers so we have a flat, fully resolved object
  const api = (await SwaggerParser.dereference(rawObj)) as OpenAPIV3.Document;

  const endpoints = new Map<string, Endpoint>();

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
              schema: param.schema ? mapSchemaNode(param.schema as OpenAPIV3.SchemaObject) : undefined,
            });
          }
        }

        // Add Request Body
        let requestBody: SchemaNode | undefined;
        if (operation.requestBody) {
          const reqBody = operation.requestBody as OpenAPIV3.RequestBodyObject;
          const contentSchema = reqBody.content?.['application/json']?.schema;
          if (contentSchema) {
            requestBody = mapSchemaNode(contentSchema as OpenAPIV3.SchemaObject);
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
              responses.set(parsedStatus, mapSchemaNode(contentSchema as OpenAPIV3.SchemaObject));
            } else if (contentSchema && statusCode === 'default') {
              responses.set(200, mapSchemaNode(contentSchema as OpenAPIV3.SchemaObject));
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

function mapSchemaNode(schema: OpenAPIV3.SchemaObject): SchemaNode {
  const node: SchemaNode = {
    type: Array.isArray(schema.type) ? schema.type[0] : (schema.type || 'unknown'),
    required: new Set<string>(schema.required || []),
  };

  if (schema.properties) {
    node.properties = new Map<string, SchemaNode>();
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      node.properties.set(key, mapSchemaNode(propSchema as OpenAPIV3.SchemaObject));
    }
  }

  if (schema.items) {
    node.items = mapSchemaNode(schema.items as OpenAPIV3.SchemaObject);
  }

  return node;
}

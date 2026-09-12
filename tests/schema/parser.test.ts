import { describe, it, expect } from 'vitest';
import { parseOpenApi } from '../../src/schema/parser.js';

describe('OpenAPI Parser', () => {
  const sampleYaml = `
openapi: "3.0.0"
info:
  title: Sample API
  version: "1.0.0"
paths:
  /users:
    get:
      summary: Get users
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
      responses:
        "200":
          description: A list of users
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/User"
components:
  schemas:
    User:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: string
        name:
          type: string
`;

  const sampleJson = JSON.stringify({
    openapi: "3.0.0",
    info: {
      title: "Sample JSON API",
      version: "1.0.0"
    },
    paths: {
      "/products": {
        post: {
          summary: "Create a product",
          parameters: [
            {
              name: "storeId",
              in: "header",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/NewProduct"
                }
              }
            }
          },
          responses: {
            "201": {
              description: "Created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id", "title"],
                    properties: {
                      id: { type: "string" },
                      title: { type: "string" }
                    }
                  }
                }
              }
            },
            default: {
              description: "Default fallback",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      message: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        NewProduct: {
          type: "object",
          required: ["title", "price"],
          properties: {
            title: { type: "string" },
            price: { type: "number" }
          }
        }
      }
    }
  }, null, 2);

  it('should parse YAML schema when .yaml filePath is provided', async () => {
    const result = await parseOpenApi(sampleYaml, 'openapi.yaml');
    expect(result.endpoints.has('GET /users')).toBe(true);

    const ep = result.endpoints.get('GET /users')!;
    expect(ep.method).toBe('GET');
    expect(ep.path).toBe('/users');
    expect(ep.parameters).toHaveLength(1);
    expect(ep.parameters[0].name).toBe('limit');

    const res200 = ep.responses.get(200);
    expect(res200).toBeDefined();
    expect(res200?.type).toBe('array');
    expect(res200?.items?.properties?.get('name')?.type).toBe('string');
  });

  it('should parse YAML schema when .yml filePath is provided', async () => {
    const result = await parseOpenApi(sampleYaml, 'schema.yml');
    expect(result.endpoints.has('GET /users')).toBe(true);
  });

  it('should parse JSON schema when .json filePath is provided', async () => {
    const result = await parseOpenApi(sampleJson, 'openapi.json');
    expect(result.endpoints.has('POST /products')).toBe(true);

    const ep = result.endpoints.get('POST /products')!;
    expect(ep.method).toBe('POST');
    expect(ep.path).toBe('/products');
    expect(ep.parameters).toHaveLength(1);
    expect(ep.parameters[0].name).toBe('storeId');
    expect(ep.parameters[0].required).toBe(true);

    // Verify dereferenced requestBody
    expect(ep.requestBody).toBeDefined();
    expect(ep.requestBody?.properties?.get('title')?.type).toBe('string');
    expect(ep.requestBody?.properties?.get('price')?.type).toBe('number');
    expect(ep.requestBody?.required.has('title')).toBe(true);

    // Verify responses
    const res201 = ep.responses.get(201);
    expect(res201).toBeDefined();
    expect(res201?.properties?.get('id')?.type).toBe('string');

    // Verify default response mapped to 200
    const resDefault = ep.responses.get(200);
    expect(resDefault).toBeDefined();
    expect(resDefault?.properties?.get('message')?.type).toBe('string');
  });

  it('should automatically fall back to parsing JSON if no filePath is specified', async () => {
    const result = await parseOpenApi(sampleJson);
    expect(result.endpoints.has('POST /products')).toBe(true);
  });

  it('should automatically fall back to parsing YAML if no filePath is specified', async () => {
    const result = await parseOpenApi(sampleYaml);
    expect(result.endpoints.has('GET /users')).toBe(true);
  });

  it('should throw an error for malformed JSON when .json is specified', async () => {
    const invalidJson = '{ "openapi": "3.0.0", invalid }';
    await expect(parseOpenApi(invalidJson, 'openapi.json')).rejects.toThrow();
  });

  it('should return empty endpoints if paths is empty object', async () => {
    const emptyPathsJson = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Empty API", version: "1.0.0" },
      paths: {}
    });
    const result = await parseOpenApi(emptyPathsJson, 'openapi.json');
    expect(result.endpoints.size).toBe(0);
  });

  it('should handle circular $ref schemas without stack overflow', async () => {
    const circularJson = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "Circular API", version: "1.0.0" },
      paths: {
        "/tree": {
          get: {
            responses: {
              "200": {
                description: "Node",
                content: {
                  "application/json": {
                    schema: {
                      $ref: "#/components/schemas/TreeNode"
                    }
                  }
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          TreeNode: {
            type: "object",
            properties: {
              value: { type: "string" },
              child: { $ref: "#/components/schemas/TreeNode" }
            }
          }
        }
      }
    });

    const result = await parseOpenApi(circularJson, 'openapi.json');
    expect(result.endpoints.has('GET /tree')).toBe(true);
    const ep = result.endpoints.get('GET /tree')!;
    const res200 = ep.responses.get(200);
    expect(res200).toBeDefined();
    expect(res200?.properties?.get('value')?.type).toBe('string');
    expect(res200?.properties?.get('child')?.type).toBe('object');
  });

  it('should return empty endpoints for empty or whitespace content', async () => {
    const emptyResult = await parseOpenApi('', 'openapi.json');
    expect(emptyResult.endpoints.size).toBe(0);

    const whitespaceResult = await parseOpenApi('   \n  ', 'openapi.yaml');
    expect(whitespaceResult.endpoints.size).toBe(0);
  });
});

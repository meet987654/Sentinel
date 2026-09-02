import { describe, it, expect } from 'vitest';
import { diffSchemas } from '../../src/schema/differ.js';
import { ApiSchema, Endpoint } from '../../src/types.js';

describe('Schema Differ', () => {
  it('should detect when an endpoint is removed', () => {
    const base: ApiSchema = {
      endpoints: new Map([
        ['GET /users', { path: '/users', method: 'GET', parameters: [], responses: new Map() }],
      ]),
    };
    const pr: ApiSchema = {
      endpoints: new Map(),
    };

    const changes = diffSchemas(base, pr);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: 'ENDPOINT_REMOVED',
      severity: 'breaking',
      path: 'GET /users',
    });
  });

  it('should detect when a required parameter is removed', () => {
    const base: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [{ name: 'id', in: 'query', required: true }],
          responses: new Map(),
        }],
      ]),
    };
    const pr: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [],
          responses: new Map(),
        }],
      ]),
    };

    const changes = diffSchemas(base, pr);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: 'FIELD_REMOVED',
      severity: 'breaking',
      path: 'GET /users.parameters.id',
    });
  });

  it('should detect when an optional parameter becomes required', () => {
    const base: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [{ name: 'age', in: 'query', required: false }],
          responses: new Map(),
        }],
      ]),
    };
    const pr: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [{ name: 'age', in: 'query', required: true }],
          responses: new Map(),
        }],
      ]),
    };

    const changes = diffSchemas(base, pr);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: 'OPTIONAL_TO_REQUIRED',
      severity: 'breaking',
      path: 'GET /users.parameters.age',
    });
  });

  it('should correctly flag a new optional parameter as safe (no breaking change)', () => {
    const base: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [],
          responses: new Map(),
        }],
      ]),
    };
    const pr: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [{ name: 'age', in: 'query', required: false }],
          responses: new Map(),
        }],
      ]),
    };

    const changes = diffSchemas(base, pr);
    expect(changes).toHaveLength(0); // Optional params are safe additions
  });

  it('should correctly flag a response field removal as breaking', () => {
    const base: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [],
          responses: new Map([
            [200, {
              type: 'object',
              required: new Set(),
              properties: new Map([
                ['email', { type: 'string', required: new Set() }]
              ])
            }]
          ]),
        }],
      ]),
    };
    const pr: ApiSchema = {
      endpoints: new Map([
        ['GET /users', {
          path: '/users',
          method: 'GET',
          parameters: [],
          responses: new Map([
            [200, {
              type: 'object',
              required: new Set(),
              properties: new Map() // email removed
            }]
          ]),
        }],
      ]),
    };

    const changes = diffSchemas(base, pr);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      type: 'FIELD_REMOVED',
      severity: 'breaking',
      path: 'GET /users.response.200.email',
    });
  });
});

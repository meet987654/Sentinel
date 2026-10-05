import { describe, it, expect } from 'vitest';
import {
  diffGraphQLSchemas,
  traceGraphQLConsumerQueries,
  GraphQLSourceDocument,
  GraphQLBreakingChange,
} from '../../src/schema/graphqlDiffer.js';
import { BreakingChange } from '../../src/types.js';

describe('GraphQL Schema Differ & AST Query Tracer', () => {
  describe('diffGraphQLSchemas', () => {
    it('detects removed fields from object types', () => {
      const baseSdl = `
        type User {
          id: ID!
          name: String
          email: String!
        }
        type Query {
          user(id: ID!): User
        }
      `;

      const headSdl = `
        type User {
          id: ID!
          email: String!
        }
        type Query {
          user(id: ID!): User
        }
      `;

      const changes = diffGraphQLSchemas(baseSdl, headSdl);
      expect(changes.length).toBeGreaterThanOrEqual(1);

      const removedField = changes.find(c => c.path === 'User.name');
      expect(removedField).toBeDefined();
      expect(removedField?.type).toBe('GRAPHQL_FIELD_REMOVED');
      expect(removedField?.severity).toBe('breaking');
      expect(removedField?.protocol).toBe('graphql');
      expect((removedField as GraphQLBreakingChange).fieldName).toBe('name');
      expect((removedField as GraphQLBreakingChange).typeName).toBe('User');
    });

    it('detects field type changes (e.g. String to Int)', () => {
      const baseSdl = `
        type Product {
          id: ID!
          price: String!
        }
        type Query {
          product(id: ID!): Product
        }
      `;

      const headSdl = `
        type Product {
          id: ID!
          price: Int!
        }
        type Query {
          product(id: ID!): Product
        }
      `;

      const changes = diffGraphQLSchemas(baseSdl, headSdl);
      const typeChange = changes.find(c => c.path === 'Product.price');
      expect(typeChange).toBeDefined();
      expect(typeChange?.type).toBe('GRAPHQL_TYPE_CHANGED');
      expect(typeChange?.severity).toBe('breaking');
      expect(typeChange?.protocol).toBe('graphql');
      expect(typeChange?.oldValue).toBe('String!');
      expect(typeChange?.newValue).toBe('Int!');
    });

    it('detects newly added required arguments on existing fields', () => {
      const baseSdl = `
        type Query {
          searchUsers(query: String): [String]
        }
      `;

      const headSdl = `
        type Query {
          searchUsers(query: String, organizationId: ID!): [String]
        }
      `;

      const changes = diffGraphQLSchemas(baseSdl, headSdl);
      const reqArg = changes.find(c => c.type === 'GRAPHQL_ARG_REQUIRED');
      expect(reqArg).toBeDefined();
      expect(reqArg?.severity).toBe('breaking');
      expect(reqArg?.protocol).toBe('graphql');
      expect((reqArg as GraphQLBreakingChange).argName).toBe('organizationId');
    });

    it('detects removed types and enum values', () => {
      const baseSdl = `
        enum Role {
          USER
          ADMIN
          MODERATOR
        }
        type DeprecatedType {
          info: String
        }
        type Query {
          role: Role
        }
      `;

      const headSdl = `
        enum Role {
          USER
          ADMIN
        }
        type Query {
          role: Role
        }
      `;

      const changes = diffGraphQLSchemas(baseSdl, headSdl);
      const enumChange = changes.find(c => c.path === 'Role.MODERATOR');
      expect(enumChange).toBeDefined();
      expect(enumChange?.severity).toBe('breaking');

      const typeChange = changes.find(c => c.type === 'GRAPHQL_TYPE_REMOVED');
      expect(typeChange).toBeDefined();
      expect(typeChange?.path).toBe('DeprecatedType');
    });

    it('handles empty or malformed SDL safely without throwing', () => {
      expect(diffGraphQLSchemas('', '')).toEqual([]);
      expect(diffGraphQLSchemas('   ', 'type Query { ping: String }')).toEqual([]);
      expect(diffGraphQLSchemas('syntax error !!!', 'type Query { ping: String }')).toEqual([]);
    });

    it('supports includeWarnings to capture dangerous but non-breaking changes', () => {
      const baseSdl = `
        enum Status {
          ACTIVE
          INACTIVE
        }
        type Query {
          status: Status
        }
      `;

      const headSdl = `
        enum Status {
          ACTIVE
          INACTIVE
          PENDING
        }
        type Query {
          status: Status
        }
      `;

      const strictChanges = diffGraphQLSchemas(baseSdl, headSdl);
      expect(strictChanges).toHaveLength(0); // adding enum value is non-breaking

      const warningChanges = diffGraphQLSchemas(baseSdl, headSdl, { includeWarnings: true });
      expect(warningChanges.length).toBeGreaterThan(0);
      expect(warningChanges[0].severity).toBe('warning');
    });
  });

  describe('traceGraphQLConsumerQueries', () => {
    const sampleChanges: BreakingChange[] = [
      {
        type: 'GRAPHQL_FIELD_REMOVED',
        severity: 'breaking',
        protocol: 'graphql',
        path: 'User.university',
        oldValue: 'String',
      },
    ];

    it('traces broken fields in pure .graphql documents with accurate line numbers', () => {
      const documents: GraphQLSourceDocument[] = [
        {
          filePath: 'src/queries/users.graphql',
          content: `query GetUserDetails($id: ID!) {
  user(id: $id) {
    id
    name
    university
    email
  }
}`,
        },
      ];

      const findings = traceGraphQLConsumerQueries(documents, sampleChanges);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toEqual({
        confidence: 'confirmed',
        filePath: 'src/queries/users.graphql',
        lineNumber: 5,
        snippet: 'university',
        property: 'university',
      });
    });

    it('traces broken fields inside TypeScript gql tagged template literals', () => {
      const tsContent = `import { gql } from '@apollo/client';

export const USER_CARD_QUERY = gql\`
  query GetUserProfile {
    profile {
      id
      university
    }
  }
\`;
`;

      const documents: GraphQLSourceDocument[] = [
        {
          filePath: 'src/components/UserCard.tsx',
          content: tsContent,
        },
      ];

      const findings = traceGraphQLConsumerQueries(documents, sampleChanges);
      expect(findings).toHaveLength(1);
      expect(findings[0].filePath).toBe('src/components/UserCard.tsx');
      expect(findings[0].property).toBe('university');
      expect(findings[0].confidence).toBe('confirmed');
      expect(findings[0].lineNumber).toBe(7);
      expect(findings[0].snippet).toBe('university');
    });

    it('falls back gracefully to regex scanning when query document has parse errors', () => {
      const documents: GraphQLSourceDocument[] = [
        {
          filePath: 'src/queries/fragment_broken.graphql',
          content: `# partial fragment with custom syntax\nfragment UserFrag on User {\n  id\n  university\n`,
        },
      ];

      const findings = traceGraphQLConsumerQueries(documents, sampleChanges);
      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0].property).toBe('university');
      expect(findings[0].lineNumber).toBe(4);
    });

    it('returns empty array when no documents or changes are provided', () => {
      expect(traceGraphQLConsumerQueries([], sampleChanges)).toEqual([]);
      expect(traceGraphQLConsumerQueries([{ filePath: 'test.ts', content: 'const x = 1;' }], [])).toEqual([]);
    });
  });
});

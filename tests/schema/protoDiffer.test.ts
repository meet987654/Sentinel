import { describe, it, expect } from 'vitest';
import {
  diffProtoSchemas,
  traceProtoConsumerCode,
  ProtoSourceDocument,
} from '../../src/schema/protoDiffer.js';
import { BreakingChange } from '../../src/types.js';

describe('Protobuf Contract Differ & Consumer Code Tracer', () => {
  describe('diffProtoSchemas', () => {
    it('detects removed fields in protobuf messages', () => {
      const baseProto = `
        syntax = "proto3";
        package acme.user;

        message User {
          string id = 1;
          string name = 2;
          string email = 3;
        }
      `;

      const headProto = `
        syntax = "proto3";
        package acme.user;

        message User {
          string id = 1;
          string email = 3;
        }
      `;

      const changes = diffProtoSchemas(baseProto, headProto);
      expect(changes.length).toBeGreaterThanOrEqual(1);

      const fieldRemoved = changes.find(c => c.path.endsWith('.name'));
      expect(fieldRemoved).toBeDefined();
      expect(fieldRemoved?.type).toBe('PROTO_FIELD_REMOVED');
      expect(fieldRemoved?.severity).toBe('breaking');
      expect(fieldRemoved?.protocol).toBe('grpc');
    });

    it('detects wire-breaking field tag number alterations', () => {
      const baseProto = `
        syntax = "proto3";
        package billing;

        message Invoice {
          string id = 1;
          double amount = 2;
        }
      `;

      const headProto = `
        syntax = "proto3";
        package billing;

        message Invoice {
          string id = 1;
          double amount = 3; // Tag changed from 2 to 3!
        }
      `;

      const changes = diffProtoSchemas(baseProto, headProto);
      const tagChanged = changes.find(c => c.type === 'PROTO_FIELD_TAG_CHANGED');
      expect(tagChanged).toBeDefined();
      expect(tagChanged?.path).toBe('billing.Invoice.amount');
      expect(tagChanged?.oldValue).toBe(2);
      expect(tagChanged?.newValue).toBe(3);
    });

    it('detects field data type changes (e.g. string to int32)', () => {
      const baseProto = `
        syntax = "proto3";
        package catalog;

        message Product {
          string id = 1;
          string price = 2;
        }
      `;

      const headProto = `
        syntax = "proto3";
        package catalog;

        message Product {
          string id = 1;
          int64 price = 2;
        }
      `;

      const changes = diffProtoSchemas(baseProto, headProto);
      const typeChanged = changes.find(c => c.type === 'PROTO_FIELD_TYPE_CHANGED');
      expect(typeChanged).toBeDefined();
      expect(typeChanged?.path).toBe('catalog.Product.price');
      expect(typeChanged?.oldValue).toBe('string');
      expect(typeChanged?.newValue).toBe('int64');
    });

    it('detects field rule changes (singular to repeated)', () => {
      const baseProto = `
        syntax = "proto3";
        package order;

        message OrderRequest {
          string order_id = 1;
          string item = 2;
        }
      `;

      const headProto = `
        syntax = "proto3";
        package order;

        message OrderRequest {
          string order_id = 1;
          repeated string item = 2;
        }
      `;

      const changes = diffProtoSchemas(baseProto, headProto);
      const ruleChanged = changes.find(c => c.type === 'PROTO_FIELD_RULE_CHANGED');
      expect(ruleChanged).toBeDefined();
      expect(ruleChanged?.path).toBe('order.OrderRequest.item');
      expect(ruleChanged?.oldValue).toBe('singular');
      expect(ruleChanged?.newValue).toBe('repeated');
    });

    it('detects removed messages, service methods, and enum values', () => {
      const baseProto = `
        syntax = "proto3";
        package auth;

        message Session {
          string token = 1;
        }

        enum Role {
          GUEST = 0;
          ADMIN = 1;
          MODERATOR = 2;
        }

        service AuthService {
          rpc Login (Session) returns (Session);
          rpc Logout (Session) returns (Session);
        }
      `;

      const headProto = `
        syntax = "proto3";
        package auth;

        enum Role {
          GUEST = 0;
          ADMIN = 1;
        }

        service AuthService {
          rpc Login (Session) returns (Session);
        }
      `;

      const changes = diffProtoSchemas(baseProto, headProto);

      const msgRemoved = changes.find(c => c.type === 'PROTO_MESSAGE_REMOVED');
      expect(msgRemoved).toBeDefined();
      expect(msgRemoved?.path).toBe('auth.Session');

      const methodRemoved = changes.find(c => c.type === 'PROTO_METHOD_REMOVED');
      expect(methodRemoved).toBeDefined();
      expect(methodRemoved?.path).toBe('auth.AuthService.Logout');

      const enumRemoved = changes.find(c => c.type === 'PROTO_ENUM_VALUE_REMOVED');
      expect(enumRemoved).toBeDefined();
      expect(enumRemoved?.path).toBe('auth.Role.MODERATOR');
    });

    it('handles empty or invalid proto inputs gracefully without crashing', () => {
      expect(diffProtoSchemas('', '')).toEqual([]);
      expect(diffProtoSchemas('syntax = "proto3";', '')).toEqual([]);
      expect(diffProtoSchemas('broken syntax !!!', 'syntax = "proto3";')).toEqual([]);
    });
  });

  describe('traceProtoConsumerCode', () => {
    const sampleChanges: BreakingChange[] = [
      {
        type: 'PROTO_FIELD_REMOVED',
        severity: 'breaking',
        protocol: 'grpc',
        path: 'acme.user.User.university',
      },
      {
        type: 'PROTO_METHOD_REMOVED',
        severity: 'breaking',
        protocol: 'grpc',
        path: 'acme.user.UserService.DeactivateUser',
      },
    ];

    it('traces direct property access and getter method calls with exact lines', () => {
      const consumerCode = `import { UserServiceClient } from './generated/user_grpc_pb';

export async function handleUserProfile(user: any) {
  const university = user.university;
  const legacyUni = user.getUniversity();
  return { university, legacyUni };
}
`;

      const documents: ProtoSourceDocument[] = [
        {
          filePath: 'src/services/userService.ts',
          content: consumerCode,
        },
      ];

      const findings = traceProtoConsumerCode(documents, sampleChanges);
      expect(findings.length).toBeGreaterThanOrEqual(2);

      const propFinding = findings.find(f => f.lineNumber === 4);
      expect(propFinding).toBeDefined();
      expect(propFinding?.snippet).toContain('user.university');
      expect(propFinding?.property).toBe('university');

      const getterFinding = findings.find(f => f.lineNumber === 5);
      expect(getterFinding).toBeDefined();
      expect(getterFinding?.snippet).toContain('user.getUniversity()');
      expect(getterFinding?.property).toBe('getUniversity');
    });

    it('traces removed service RPC method invocations in consumer code', () => {
      const consumerCode = `const client = new UserServiceClient('localhost:50051');
await client.DeactivateUser({ id: '123' });
`;

      const documents: ProtoSourceDocument[] = [
        {
          filePath: 'src/workers/cleanup.ts',
          content: consumerCode,
        },
      ];

      const findings = traceProtoConsumerCode(documents, sampleChanges);
      const methodFinding = findings.find(f => f.property === 'DeactivateUser');
      expect(methodFinding).toBeDefined();
      expect(methodFinding?.lineNumber).toBe(2);
      expect(methodFinding?.confidence).toBe('confirmed');
    });

    it('returns empty array when no documents or changes provided', () => {
      expect(traceProtoConsumerCode([], sampleChanges)).toEqual([]);
      expect(traceProtoConsumerCode([{ filePath: 'test.ts', content: 'const a = 1;' }], [])).toEqual([]);
    });
  });
});

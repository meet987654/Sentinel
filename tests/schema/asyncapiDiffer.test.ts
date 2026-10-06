import { describe, it, expect } from 'vitest';
import {
  diffAsyncApiSchemas,
  traceAsyncApiConsumerCode,
  AsyncApiSourceDocument,
} from '../../src/schema/asyncapiDiffer.js';
import { BreakingChange } from '../../src/types.js';

describe('AsyncAPI Event Schema Differ & Consumer Code Tracer', () => {
  describe('diffAsyncApiSchemas', () => {
    it('detects removed properties in AsyncAPI 2.x message payloads', () => {
      const baseYaml = `
asyncapi: '2.6.0'
info:
  title: User Events
  version: 1.0.0
channels:
  user/signedup:
    publish:
      message:
        name: UserSignedUp
        payload:
          type: object
          properties:
            userId:
              type: string
            email:
              type: string
            university:
              type: string
          required:
            - userId
            - email
`;

      const headYaml = `
asyncapi: '2.6.0'
info:
  title: User Events
  version: 1.1.0
channels:
  user/signedup:
    publish:
      message:
        name: UserSignedUp
        payload:
          type: object
          properties:
            userId:
              type: string
            email:
              type: string
          required:
            - userId
            - email
`;

      const changes = diffAsyncApiSchemas(baseYaml, headYaml);
      expect(changes.length).toBeGreaterThanOrEqual(1);

      const fieldRemoved = changes.find(c => c.path.endsWith('.university'));
      expect(fieldRemoved).toBeDefined();
      expect(fieldRemoved?.type).toBe('ASYNCAPI_FIELD_REMOVED');
      expect(fieldRemoved?.severity).toBe('breaking');
      expect(fieldRemoved?.protocol).toBe('asyncapi');
    });

    it('detects property data type alterations in message payloads', () => {
      const baseYaml = `
asyncapi: '2.6.0'
channels:
  order/created:
    subscribe:
      message:
        name: OrderCreated
        payload:
          type: object
          properties:
            orderId:
              type: string
            totalAmount:
              type: string
`;

      const headYaml = `
asyncapi: '2.6.0'
channels:
  order/created:
    subscribe:
      message:
        name: OrderCreated
        payload:
          type: object
          properties:
            orderId:
              type: string
            totalAmount:
              type: number
`;

      const changes = diffAsyncApiSchemas(baseYaml, headYaml);
      const typeChanged = changes.find(c => c.type === 'ASYNCAPI_TYPE_CHANGED');
      expect(typeChanged).toBeDefined();
      expect(typeChanged?.path).toBe('order/created.OrderCreated.totalAmount');
      expect(typeChanged?.oldValue).toBe('string');
      expect(typeChanged?.newValue).toBe('number');
    });

    it('detects shifts from optional to required properties', () => {
      const baseYaml = `
asyncapi: '2.6.0'
channels:
  payments:
    publish:
      message:
        name: PaymentReceived
        payload:
          type: object
          properties:
            paymentId:
              type: string
            riskScore:
              type: number
          required:
            - paymentId
`;

      const headYaml = `
asyncapi: '2.6.0'
channels:
  payments:
    publish:
      message:
        name: PaymentReceived
        payload:
          type: object
          properties:
            paymentId:
              type: string
            riskScore:
              type: number
          required:
            - paymentId
            - riskScore
`;

      const changes = diffAsyncApiSchemas(baseYaml, headYaml);
      const reqAdded = changes.find(c => c.type === 'ASYNCAPI_REQUIRED_ADDED');
      expect(reqAdded).toBeDefined();
      expect(reqAdded?.path).toBe('payments.PaymentReceived.riskScore');
      expect(reqAdded?.oldValue).toBe(false);
      expect(reqAdded?.newValue).toBe(true);
    });

    it('detects removed channels and operations', () => {
      const baseYaml = `
asyncapi: '2.6.0'
channels:
  notifications/email:
    publish:
      message:
        name: EmailNotification
        payload:
          type: object
  notifications/sms:
    publish:
      message:
        name: SmsNotification
        payload:
          type: object
`;

      const headYaml = `
asyncapi: '2.6.0'
channels:
  notifications/email:
    publish:
      message:
        name: EmailNotification
        payload:
          type: object
`;

      const changes = diffAsyncApiSchemas(baseYaml, headYaml);
      const chRemoved = changes.find(c => c.type === 'ASYNCAPI_CHANNEL_REMOVED');
      expect(chRemoved).toBeDefined();
      expect(chRemoved?.path).toBe('notifications/sms');
    });

    it('resolves internal component $ref schema references', () => {
      const baseYaml = `
asyncapi: '2.6.0'
channels:
  audit/logs:
    publish:
      message:
        $ref: '#/components/messages/AuditMsg'
components:
  messages:
    AuditMsg:
      payload:
        $ref: '#/components/schemas/AuditPayload'
  schemas:
    AuditPayload:
      type: object
      properties:
        actor:
          type: string
        action:
          type: string
`;

      const headYaml = `
asyncapi: '2.6.0'
channels:
  audit/logs:
    publish:
      message:
        $ref: '#/components/messages/AuditMsg'
components:
  messages:
    AuditMsg:
      payload:
        $ref: '#/components/schemas/AuditPayload'
  schemas:
    AuditPayload:
      type: object
      properties:
        actor:
          type: string
`;

      const changes = diffAsyncApiSchemas(baseYaml, headYaml);
      const fieldRemoved = changes.find(c => c.path.endsWith('.action'));
      expect(fieldRemoved).toBeDefined();
      expect(fieldRemoved?.type).toBe('ASYNCAPI_FIELD_REMOVED');
    });

    it('handles empty or malformed inputs without throwing', () => {
      expect(diffAsyncApiSchemas('', '')).toEqual([]);
      expect(diffAsyncApiSchemas('broken: yaml: :', 'asyncapi: 2.0.0')).toEqual([]);
    });
  });

  describe('traceAsyncApiConsumerCode', () => {
    const sampleChanges: BreakingChange[] = [
      {
        type: 'ASYNCAPI_FIELD_REMOVED',
        severity: 'breaking',
        protocol: 'asyncapi',
        path: 'user/signedup.UserSignedUp.university',
      },
    ];

    it('traces event payload property access and destructuring with exact line numbers', () => {
      const consumerCode = `import { kafkaConsumer } from './kafka';

kafkaConsumer.on('user/signedup', (event: any) => {
  const university = event.university;
  const { userId } = event.payload;
  console.log('User signed up from', university);
});
`;

      const documents: AsyncApiSourceDocument[] = [
        {
          filePath: 'src/subscribers/userEvents.ts',
          content: consumerCode,
        },
      ];

      const findings = traceAsyncApiConsumerCode(documents, sampleChanges);
      expect(findings.length).toBeGreaterThanOrEqual(1);

      const finding = findings.find(f => f.lineNumber === 4);
      expect(finding).toBeDefined();
      expect(finding?.property).toBe('university');
      expect(finding?.confidence).toBe('confirmed');
      expect(finding?.snippet).toContain('event.university');
    });

    it('returns empty array when no documents or changes provided', () => {
      expect(traceAsyncApiConsumerCode([], sampleChanges)).toEqual([]);
      expect(traceAsyncApiConsumerCode([{ filePath: 'index.ts', content: 'const a = 1;' }], [])).toEqual([]);
    });
  });
});

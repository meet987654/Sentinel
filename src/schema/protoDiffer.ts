import { BreakingChange, ConsumerFinding } from '../types.js';
import protobuf from 'protobufjs';

export interface ProtoBreakingChange extends BreakingChange {
  protocol: 'grpc';
  messageName?: string;
  serviceName?: string;
  fieldName?: string;
  methodName?: string;
  tagNumber?: number;
}

export interface ProtoDiffOptions {
  includeWarnings?: boolean;
}

export interface ProtoSourceDocument {
  filePath: string;
  content: string;
}

interface FlattenedField {
  name: string;
  id: number;
  type: string;
  rule?: string;
}

interface FlattenedMessage {
  name: string;
  fullName: string;
  fields: Map<string, FlattenedField>;
}

interface FlattenedMethod {
  name: string;
  requestType: string;
  responseType: string;
}

interface FlattenedService {
  name: string;
  fullName: string;
  methods: Map<string, FlattenedMethod>;
}

interface FlattenedEnum {
  name: string;
  fullName: string;
  values: Map<string, number>;
}

interface FlattenedProtoSchema {
  messages: Map<string, FlattenedMessage>;
  services: Map<string, FlattenedService>;
  enums: Map<string, FlattenedEnum>;
}

/**
 * Recursively extracts messages, services, and enums from a parsed protobufjs Namespace / Root object.
 */
function extractSchemaElements(
  obj: any,
  parentName: string,
  schema: FlattenedProtoSchema
): void {
  if (!obj || typeof obj !== 'object') return;

  const currentName = parentName ? `${parentName}.${obj.name || ''}` : obj.name || '';

  // 1. Process Messages (Type)
  if (obj.fields && typeof obj.fields === 'object') {
    const fieldsMap = new Map<string, FlattenedField>();
    for (const [fName, fObj] of Object.entries<any>(obj.fields)) {
      fieldsMap.set(fName, {
        name: fName,
        id: fObj.id,
        type: fObj.type,
        rule: fObj.rule || undefined,
      });
    }

    schema.messages.set(currentName, {
      name: obj.name || currentName,
      fullName: currentName,
      fields: fieldsMap,
    });
  }

  // 2. Process Services
  if (obj.methods && typeof obj.methods === 'object') {
    const methodsMap = new Map<string, FlattenedMethod>();
    for (const [mName, mObj] of Object.entries<any>(obj.methods)) {
      methodsMap.set(mName, {
        name: mName,
        requestType: mObj.requestType,
        responseType: mObj.responseType,
      });
    }

    schema.services.set(currentName, {
      name: obj.name || currentName,
      fullName: currentName,
      methods: methodsMap,
    });
  }

  // 3. Process Enums
  if (obj.values && typeof obj.values === 'object' && !obj.fields && !obj.methods) {
    const valuesMap = new Map<string, number>();
    for (const [vName, vVal] of Object.entries<any>(obj.values)) {
      valuesMap.set(vName, Number(vVal));
    }

    schema.enums.set(currentName, {
      name: obj.name || currentName,
      fullName: currentName,
      values: valuesMap,
    });
  }

  // 4. Traverse nested objects (Namespaces or nested Types)
  if (obj.nested && typeof obj.nested === 'object') {
    for (const [childName, childObj] of Object.entries<any>(obj.nested)) {
      const childObjWithMeta = { ...childObj, name: childObj.name || childName };
      extractSchemaElements(childObjWithMeta, currentName, schema);
    }
  }
}

/**
 * Parses a raw .proto content string and extracts flattened messages, services, and enums.
 */
function parseAndFlattenProto(protoContent: string): FlattenedProtoSchema | null {
  if (!protoContent || !protoContent.trim()) {
    return null;
  }

  try {
    const parsed = protobuf.parse(protoContent, { keepCase: true });
    const schema: FlattenedProtoSchema = {
      messages: new Map(),
      services: new Map(),
      enums: new Map(),
    };

    extractSchemaElements(parsed.root.toJSON(), '', schema);
    return schema;
  } catch {
    return null;
  }
}

/**
 * Compares two Protobuf specification strings (proto2/proto3) and returns
 * structured breaking changes: field removals, tag number changes, type modifications,
 * rule modifications (optional to repeated), service method removals, and enum value removals.
 */
export function diffProtoSchemas(
  baseProto: string,
  headProto: string,
  _options?: ProtoDiffOptions
): BreakingChange[] {
  const base = parseAndFlattenProto(baseProto);
  const head = parseAndFlattenProto(headProto);

  if (!base || !head) {
    return [];
  }

  const changes: BreakingChange[] = [];

  // 1. Compare Messages and Fields
  for (const [msgName, baseMsg] of base.messages.entries()) {
    const headMsg = head.messages.get(msgName);
    if (!headMsg) {
      changes.push({
        type: 'PROTO_MESSAGE_REMOVED',
        severity: 'breaking',
        protocol: 'grpc',
        path: msgName,
        oldValue: msgName,
      });
      continue;
    }

    for (const [fieldName, baseField] of baseMsg.fields.entries()) {
      const headField = headMsg.fields.get(fieldName);
      const fieldPath = `${msgName}.${fieldName}`;

      if (!headField) {
        // Field was deleted
        changes.push({
          type: 'PROTO_FIELD_REMOVED',
          severity: 'breaking',
          protocol: 'grpc',
          path: fieldPath,
          oldValue: baseField.type,
        });
        continue;
      }

      // Check Tag Number / Wire ID (Critical in binary protobuf encoding)
      if (baseField.id !== headField.id) {
        changes.push({
          type: 'PROTO_FIELD_TAG_CHANGED',
          severity: 'breaking',
          protocol: 'grpc',
          path: fieldPath,
          oldValue: baseField.id,
          newValue: headField.id,
        });
      }

      // Check Data Type alteration
      if (baseField.type !== headField.type) {
        changes.push({
          type: 'PROTO_FIELD_TYPE_CHANGED',
          severity: 'breaking',
          protocol: 'grpc',
          path: fieldPath,
          oldValue: baseField.type,
          newValue: headField.type,
        });
      }

      // Check Rule changes (e.g. singular to repeated or vice-versa)
      const baseRule = baseField.rule || 'singular';
      const headRule = headField.rule || 'singular';
      if (baseRule !== headRule) {
        changes.push({
          type: 'PROTO_FIELD_RULE_CHANGED',
          severity: 'breaking',
          protocol: 'grpc',
          path: fieldPath,
          oldValue: baseRule,
          newValue: headRule,
        });
      }
    }
  }

  // 2. Compare Services and RPC Methods
  for (const [serviceName, baseService] of base.services.entries()) {
    const headService = head.services.get(serviceName);
    if (!headService) {
      changes.push({
        type: 'PROTO_METHOD_REMOVED',
        severity: 'breaking',
        protocol: 'grpc',
        path: serviceName,
        oldValue: serviceName,
      });
      continue;
    }

    for (const [methodName] of baseService.methods.entries()) {
      const headMethod = headService.methods.get(methodName);
      if (!headMethod) {
        changes.push({
          type: 'PROTO_METHOD_REMOVED',
          severity: 'breaking',
          protocol: 'grpc',
          path: `${serviceName}.${methodName}`,
          oldValue: methodName,
        });
      }
    }
  }

  // 3. Compare Enums and Values
  for (const [enumName, baseEnum] of base.enums.entries()) {
    const headEnum = head.enums.get(enumName);
    if (!headEnum) {
      continue;
    }

    for (const [valName, baseVal] of baseEnum.values.entries()) {
      const headVal = headEnum.values.get(valName);
      if (headVal === undefined || headVal !== baseVal) {
        changes.push({
          type: 'PROTO_ENUM_VALUE_REMOVED',
          severity: 'breaking',
          protocol: 'grpc',
          path: `${enumName}.${valName}`,
          oldValue: baseVal,
          newValue: headVal,
        });
      }
    }
  }

  return changes;
}

/**
 * Traces protobuf breaking changes into consumer TypeScript/JavaScript source documents.
 * Scans for direct property access, getter calls (e.g. getFieldName()), method invocations,
 * and destructured assignments referencing the broken protobuf fields or methods.
 */
export function traceProtoConsumerCode(
  documents: ProtoSourceDocument[],
  changes: BreakingChange[]
): ConsumerFinding[] {
  const findings: ConsumerFinding[] = [];
  const seenKeys = new Set<string>();

  if (!documents || documents.length === 0 || !changes || changes.length === 0) {
    return [];
  }

  // Collect target symbols: field names, getter variants, RPC method names
  const targetSymbols = new Set<string>();
  for (const change of changes) {
    const pathParts = change.path.split('.');
    const leaf = pathParts[pathParts.length - 1].trim();
    if (leaf) {
      targetSymbols.add(leaf);
      // Also add camelCase / getter conventions: "user_name" -> "getUserName", "name" -> "getName"
      const capitalized = leaf.charAt(0).toUpperCase() + leaf.slice(1);
      targetSymbols.add(`get${capitalized}`);
      targetSymbols.add(`set${capitalized}`);
    }
  }

  if (targetSymbols.size === 0) {
    return [];
  }

  for (const doc of documents) {
    const lines = doc.content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const symbol of targetSymbols) {
        const wordRegex = new RegExp(`\\b${symbol}\\b`);
        if (wordRegex.test(line)) {
          const lineNumber = i + 1;
          const key = `${doc.filePath}:${lineNumber}:${symbol}`;

          if (!seenKeys.has(key)) {
            seenKeys.add(key);

            // Confirmed confidence if calling getter/method or direct property access
            const isConfirmed =
              new RegExp(`\\.${symbol}\\b|\\b${symbol}\\s*\\(`).test(line) ||
              new RegExp(`\\{[^}]*\\b${symbol}\\b[^}]*\\}`).test(line);

            findings.push({
              confidence: isConfirmed ? 'confirmed' : 'high',
              filePath: doc.filePath,
              lineNumber,
              snippet: line.trim(),
              property: symbol,
            });
          }
        }
      }
    }
  }

  return findings;
}

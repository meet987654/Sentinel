import { BreakingChange, ConsumerFinding } from '../types.js';
import yaml from 'js-yaml';

export interface AsyncApiBreakingChange extends BreakingChange {
  protocol: 'asyncapi';
  channelName?: string;
  messageName?: string;
  propertyName?: string;
}

export interface AsyncApiDiffOptions {
  includeWarnings?: boolean;
}

export interface AsyncApiSourceDocument {
  filePath: string;
  content: string;
}

interface NormalizedProperty {
  type: string;
  required: boolean;
  properties?: Map<string, NormalizedProperty>;
}

interface NormalizedChannel {
  name: string;
  messages: Map<string, NormalizedMessage>;
}

interface NormalizedMessage {
  name: string;
  payloadType: string;
  properties: Map<string, NormalizedProperty>;
}

interface NormalizedAsyncApiSpec {
  channels: Map<string, NormalizedChannel>;
}

/**
 * Resolves local JSON/YAML pointers (e.g. #/components/schemas/User) within an AsyncAPI root object.
 */
function resolveRef(root: any, ref: string, visited: Set<string> = new Set()): any {
  if (!ref || !ref.startsWith('#/')) return null;
  if (visited.has(ref)) return null;
  visited.add(ref);

  const tokens = ref.substring(2).split('/');
  let curr = root;
  for (const token of tokens) {
    if (!curr || typeof curr !== 'object') return null;
    curr = curr[token];
  }

  if (curr && typeof curr === 'object' && curr.$ref) {
    return resolveRef(root, curr.$ref, visited);
  }
  return curr;
}

/**
 * Normalizes property schemas recursively into structured maps.
 */
function normalizeProperties(
  propsObj: any,
  requiredList: string[] = [],
  root: any,
  depth = 0
): Map<string, NormalizedProperty> {
  const result = new Map<string, NormalizedProperty>();
  if (!propsObj || typeof propsObj !== 'object' || depth > 8) return result;

  const requiredSet = new Set(requiredList);

  for (const [propName, rawProp] of Object.entries<any>(propsObj)) {
    let prop = rawProp;
    if (prop && prop.$ref) {
      prop = resolveRef(root, prop.$ref) || prop;
    }

    const pType = prop?.type ? (Array.isArray(prop.type) ? prop.type.join('/') : String(prop.type)) : 'any';
    const isRequired = requiredSet.has(propName);

    let childProps: Map<string, NormalizedProperty> | undefined;
    if (prop?.properties && typeof prop.properties === 'object') {
      const childRequired = Array.isArray(prop.required) ? prop.required : [];
      childProps = normalizeProperties(prop.properties, childRequired, root, depth + 1);
    }

    result.set(propName, {
      type: pType,
      required: isRequired,
      properties: childProps,
    });
  }

  return result;
}

/**
 * Parses and normalizes an AsyncAPI 2.x or 3.x specification into channels, messages, and payloads.
 */
function parseAndNormalizeAsyncApi(content: string): NormalizedAsyncApiSpec | null {
  if (!content || !content.trim()) return null;

  let root: any;
  try {
    root = yaml.load(content);
  } catch {
    return null;
  }

  if (!root || typeof root !== 'object') return null;

  const channelsMap = new Map<string, NormalizedChannel>();

  // AsyncAPI 2.x and 3.x both feature a top-level `channels` object
  const rawChannels = root.channels;
  if (rawChannels && typeof rawChannels === 'object') {
    for (const [rawChName, rawChObj] of Object.entries<any>(rawChannels)) {
      let chObj = rawChObj;
      if (chObj && chObj.$ref) {
        chObj = resolveRef(root, chObj.$ref) || chObj;
      }
      if (!chObj || typeof chObj !== 'object') continue;

      // In 3.x, address might specify the topic/queue name; otherwise use channel key
      const channelAddress = chObj.address || rawChName;
      const messagesMap = new Map<string, NormalizedMessage>();

      // Extract operations/messages:
      // 1. AsyncAPI 2.x: chObj.publish.message, chObj.subscribe.message
      const candidateOps = [chObj.publish, chObj.subscribe].filter(Boolean);
      for (const op of candidateOps) {
        let msg = op.message;
        if (msg && msg.$ref) {
          msg = resolveRef(root, msg.$ref) || msg;
        }
        if (msg && typeof msg === 'object') {
          const msgName = msg.name || msg.title || 'DefaultMessage';
          let payload = msg.payload;
          if (payload && payload.$ref) {
            payload = resolveRef(root, payload.$ref) || payload;
          }

          const reqList = Array.isArray(payload?.required) ? payload.required : [];
          const props = payload?.properties ? normalizeProperties(payload.properties, reqList, root) : new Map();

          messagesMap.set(msgName, {
            name: msgName,
            payloadType: payload?.type || 'object',
            properties: props,
          });
        }
      }

      // 2. AsyncAPI 3.x: chObj.messages
      if (chObj.messages && typeof chObj.messages === 'object') {
        for (const [mKey, rawMsg] of Object.entries<any>(chObj.messages)) {
          let msg = rawMsg;
          if (msg && msg.$ref) {
            msg = resolveRef(root, msg.$ref) || msg;
          }
          if (msg && typeof msg === 'object') {
            const msgName = msg.name || msg.title || mKey;
            let payload = msg.payload;
            if (payload && payload.$ref) {
              payload = resolveRef(root, payload.$ref) || payload;
            }

            const reqList = Array.isArray(payload?.required) ? payload.required : [];
            const props = payload?.properties ? normalizeProperties(payload.properties, reqList, root) : new Map();

            messagesMap.set(msgName, {
              name: msgName,
              payloadType: payload?.type || 'object',
              properties: props,
            });
          }
        }
      }

      channelsMap.set(channelAddress, {
        name: channelAddress,
        messages: messagesMap,
      });
    }
  }

  return { channels: channelsMap };
}

/**
 * Recursively diffs normalized property trees and emits breaking changes.
 */
function diffProperties(
  baseProps: Map<string, NormalizedProperty>,
  headProps: Map<string, NormalizedProperty>,
  pathPrefix: string,
  changes: BreakingChange[]
): void {
  for (const [propName, baseProp] of baseProps.entries()) {
    const headProp = headProps.get(propName);
    const propPath = `${pathPrefix}.${propName}`;

    if (!headProp) {
      // Property removed
      changes.push({
        type: 'ASYNCAPI_FIELD_REMOVED',
        severity: 'breaking',
        protocol: 'asyncapi',
        path: propPath,
        oldValue: baseProp.type,
      });
      continue;
    }

    // Type changed
    if (baseProp.type !== headProp.type && baseProp.type !== 'any' && headProp.type !== 'any') {
      changes.push({
        type: 'ASYNCAPI_TYPE_CHANGED',
        severity: 'breaking',
        protocol: 'asyncapi',
        path: propPath,
        oldValue: baseProp.type,
        newValue: headProp.type,
      });
    }

    // Check optional to required shift (breaking for event producers / consumers)
    if (!baseProp.required && headProp.required) {
      changes.push({
        type: 'ASYNCAPI_REQUIRED_ADDED',
        severity: 'breaking',
        protocol: 'asyncapi',
        path: propPath,
        oldValue: false,
        newValue: true,
      });
    }

    // Recurse into nested properties
    if (baseProp.properties && headProp.properties) {
      diffProperties(baseProp.properties, headProp.properties, propPath, changes);
    }
  }
}

/**
 * Compares two AsyncAPI 2.x / 3.x specifications and returns structured breaking changes.
 */
export function diffAsyncApiSchemas(
  baseContent: string,
  headContent: string,
  _options?: AsyncApiDiffOptions
): BreakingChange[] {
  const base = parseAndNormalizeAsyncApi(baseContent);
  const head = parseAndNormalizeAsyncApi(headContent);

  if (!base || !head) return [];

  const changes: BreakingChange[] = [];

  for (const [chName, baseChannel] of base.channels.entries()) {
    const headChannel = head.channels.get(chName);
    if (!headChannel) {
      changes.push({
        type: 'ASYNCAPI_CHANNEL_REMOVED',
        severity: 'breaking',
        protocol: 'asyncapi',
        path: chName,
        oldValue: chName,
      });
      continue;
    }

    for (const [msgName, baseMsg] of baseChannel.messages.entries()) {
      const headMsg = headChannel.messages.get(msgName);
      const msgPath = `${chName}.${msgName}`;

      if (!headMsg) {
        changes.push({
          type: 'ASYNCAPI_MESSAGE_REMOVED',
          severity: 'breaking',
          protocol: 'asyncapi',
          path: msgPath,
          oldValue: msgName,
        });
        continue;
      }

      // Diff payload property trees
      diffProperties(baseMsg.properties, headMsg.properties, msgPath, changes);
    }
  }

  return changes;
}

/**
 * Traces AsyncAPI breaking changes into consumer TypeScript/JavaScript source code.
 * Scans event handlers, callback parameters, channel references, and payload property accesses.
 */
export function traceAsyncApiConsumerCode(
  documents: AsyncApiSourceDocument[],
  changes: BreakingChange[]
): ConsumerFinding[] {
  const findings: ConsumerFinding[] = [];
  const seenKeys = new Set<string>();

  if (!documents || documents.length === 0 || !changes || changes.length === 0) {
    return [];
  }

  // Extract symbols: leaf properties, channel strings, message names
  const targetProperties = new Set<string>();
  const targetChannels = new Set<string>();

  for (const change of changes) {
    const pathParts = change.path.split('.');
    const leaf = pathParts[pathParts.length - 1].trim();
    if (leaf) {
      targetProperties.add(leaf);
    }
    const channel = pathParts[0].trim();
    if (channel) {
      targetChannels.add(channel);
    }
  }

  for (const doc of documents) {
    const lines = doc.content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const prop of targetProperties) {
        const propRegex = new RegExp(`\\b${prop}\\b`);
        if (propRegex.test(line)) {
          const lineNumber = i + 1;
          const key = `${doc.filePath}:${lineNumber}:${prop}`;

          if (!seenKeys.has(key)) {
            seenKeys.add(key);

            // Confirmed if property access (`payload.email`), destructuring (`{ email }`), or event parameter
            const isConfirmed =
              new RegExp(`\\.${prop}\\b|\\{[^}]*\\b${prop}\\b[^}]*\\}`).test(line) ||
              new RegExp(`\\b(event|payload|message|msg|data)\\.${prop}\\b`).test(line);

            findings.push({
              confidence: isConfirmed ? 'confirmed' : 'high',
              filePath: doc.filePath,
              lineNumber,
              snippet: line.trim(),
              property: prop,
            });
          }
        }
      }
    }
  }

  return findings;
}

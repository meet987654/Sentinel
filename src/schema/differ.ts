import { ApiSchema, BreakingChange, SchemaNode } from '../types.js';

export function diffSchemas(base: ApiSchema, pr: ApiSchema): BreakingChange[] {
  const changes: BreakingChange[] = [];

  // Check for endpoint removal
  for (const [endpointKey, baseEndpoint] of base.endpoints.entries()) {
    const prEndpoint = pr.endpoints.get(endpointKey);
    if (!prEndpoint) {
      changes.push({
        type: 'ENDPOINT_REMOVED',
        severity: 'breaking',
        path: endpointKey,
      });
      continue;
    }

    // Check parameters
    for (const baseParam of baseEndpoint.parameters) {
      const prParam = prEndpoint.parameters.find(p => p.name === baseParam.name && p.in === baseParam.in);
      
      if (!prParam) {
        changes.push({
          type: 'FIELD_REMOVED',
          severity: baseParam.required ? 'breaking' : 'warning',
          path: `${endpointKey}.parameters.${baseParam.name}`,
        });
      } else {
        if (!baseParam.required && prParam.required) {
          changes.push({
            type: 'OPTIONAL_TO_REQUIRED',
            severity: 'breaking',
            path: `${endpointKey}.parameters.${baseParam.name}`,
          });
        } else if (baseParam.required && !prParam.required) {
          changes.push({
            type: 'OPTIONAL_TO_REQUIRED',
            severity: 'warning',
            path: `${endpointKey}.parameters.${baseParam.name}`,
          });
        }

        if (baseParam.schema && prParam.schema && baseParam.schema.type !== prParam.schema.type) {
          changes.push({
            type: 'TYPE_CHANGED',
            severity: 'breaking',
            path: `${endpointKey}.parameters.${baseParam.name}`,
            oldValue: baseParam.schema.type,
            newValue: prParam.schema.type,
          });
        }
      }
    }
    
    for (const prParam of prEndpoint.parameters) {
      const baseParam = baseEndpoint.parameters.find(p => p.name === prParam.name && p.in === prParam.in);
      if (!baseParam && prParam.required) {
        changes.push({
          type: 'OPTIONAL_TO_REQUIRED',
          severity: 'breaking',
          path: `${endpointKey}.parameters.${prParam.name}`,
        });
      }
    }

    // Check responses
    for (const [statusCode, baseResponse] of baseEndpoint.responses.entries()) {
      if (statusCode >= 200 && statusCode < 300) {
        const prResponse = prEndpoint.responses.get(statusCode);
        if (prResponse) {
          diffNodes(baseResponse, prResponse, `${endpointKey}.response.${statusCode}`, changes);
        } else {
           changes.push({
             type: 'FIELD_REMOVED',
             severity: 'breaking',
             path: `${endpointKey}.response.${statusCode}`,
           });
        }
      }
    }
  }

  return changes;
}

function diffNodes(base: SchemaNode, pr: SchemaNode, path: string, changes: BreakingChange[]) {
  // Check for Nullability removal
  if (base.nullable && !pr.nullable) {
    changes.push({
      type: 'NULLABLE_REMOVED',
      severity: 'breaking',
      path,
      oldValue: 'nullable',
      newValue: 'non-nullable',
    });
  }

  if (base.type !== pr.type) {
    changes.push({
      type: 'TYPE_CHANGED',
      severity: 'breaking',
      path,
      oldValue: base.type,
      newValue: pr.type,
    });
    return;
  }

  // Check oneOf variant removals
  if (base.oneOf) {
    const prOneOf = pr.oneOf || [];
    for (const baseVar of base.oneOf) {
      const match = prOneOf.find(prVar => isVariantMatch(baseVar, prVar));
      if (!match) {
        changes.push({
          type: 'VARIANT_REMOVED',
          severity: 'breaking',
          path: `${path}.oneOf.${baseVar.type}`,
          oldValue: baseVar.type,
        });
      } else {
        diffNodes(baseVar, match, `${path}.oneOf.${baseVar.type}`, changes);
      }
    }
  }

  // Check anyOf variant removals
  if (base.anyOf) {
    const prAnyOf = pr.anyOf || [];
    for (const baseVar of base.anyOf) {
      const match = prAnyOf.find(prVar => isVariantMatch(baseVar, prVar));
      if (!match) {
        changes.push({
          type: 'VARIANT_REMOVED',
          severity: 'breaking',
          path: `${path}.anyOf.${baseVar.type}`,
          oldValue: baseVar.type,
        });
      } else {
        diffNodes(baseVar, match, `${path}.anyOf.${baseVar.type}`, changes);
      }
    }
  }

  // Diff properties (for objects)
  if (base.properties) {
    const prProperties = pr.properties || new Map<string, SchemaNode>();

    for (const [propName, baseProp] of base.properties.entries()) {
      const prProp = prProperties.get(propName);
      const propPath = `${path}.${propName}`;

      if (!prProp) {
        changes.push({
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: propPath,
        });
      } else {
        const wasRequired = base.required.has(propName);
        const isRequired = pr.required.has(propName);

        if (!wasRequired && isRequired) {
          changes.push({
            type: 'OPTIONAL_TO_REQUIRED',
            severity: 'breaking',
            path: propPath,
          });
        } else if (wasRequired && !isRequired) {
          changes.push({
            type: 'OPTIONAL_TO_REQUIRED',
            severity: 'warning',
            path: propPath,
          });
        }

        diffNodes(baseProp, prProp, propPath, changes);
      }
    }
  }

  // Diff items (for arrays)
  if (base.items && pr.items) {
    diffNodes(base.items, pr.items, `${path}.[]`, changes);
  }
}

function isVariantMatch(a: SchemaNode, b: SchemaNode): boolean {
  if (a.type !== b.type) return false;
  if (a.properties && b.properties) {
    const aKeys = Array.from(a.properties.keys());
    const bKeys = Array.from(b.properties.keys());
    if (aKeys.length > 0 && bKeys.length > 0) {
      const overlap = aKeys.filter(k => bKeys.includes(k));
      return overlap.length > 0;
    }
  }
  return true;
}

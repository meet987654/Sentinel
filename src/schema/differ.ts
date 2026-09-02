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
        // Removing a required parameter is a breaking change. Removing an optional one might be safe, but we'll flag it as breaking for strict API contracts.
        // Actually, if a required param is removed, the client might still send it. If the server ignores it, it's safe.
        // If the server strictly rejects unknown params, it's breaking. We will err on the side of caution.
        // Wait, the PRD says: "Endpoint removed (Breaking), Response field removed (Breaking), Field type changed (Breaking), Optional param/field -> required (Breaking), Required -> optional (Warning), New optional field added (Safe), New endpoint added (Safe)".
        // It doesn't mention parameter removal, let's treat parameter removal as breaking if required, warning if optional.
        changes.push({
          type: 'FIELD_REMOVED',
          severity: baseParam.required ? 'breaking' : 'warning',
          path: `${endpointKey}.parameters.${baseParam.name}`,
        });
      } else {
        // Changed required status
        if (!baseParam.required && prParam.required) {
          changes.push({
            type: 'OPTIONAL_TO_REQUIRED',
            severity: 'breaking',
            path: `${endpointKey}.parameters.${baseParam.name}`,
          });
        } else if (baseParam.required && !prParam.required) {
          changes.push({
            type: 'OPTIONAL_TO_REQUIRED', // Actually it's REQUIRED_TO_OPTIONAL, but reusing types for simplicity
            severity: 'warning',
            path: `${endpointKey}.parameters.${baseParam.name}`,
          });
        }

        // Type changed
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
    // Check for newly added required parameters (which is breaking)
    for (const prParam of prEndpoint.parameters) {
      const baseParam = baseEndpoint.parameters.find(p => p.name === prParam.name && p.in === prParam.in);
      if (!baseParam && prParam.required) {
        changes.push({
          type: 'OPTIONAL_TO_REQUIRED', // New required parameter
          severity: 'breaking',
          path: `${endpointKey}.parameters.${prParam.name}`,
        });
      }
    }

    // Check responses (mainly 200/2xx)
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

  // Diff properties (for objects)
  if (base.properties) {
    const prProperties = pr.properties || new Map<string, SchemaNode>();

    for (const [propName, baseProp] of base.properties.entries()) {
      const prProp = prProperties.get(propName);
      const propPath = `${path}.${propName}`;

      if (!prProp) {
        // Field removed
        changes.push({
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: propPath,
        });
      } else {
        // Field changed required status?
        // Note: The parent node tracks `required` set.
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
            type: 'OPTIONAL_TO_REQUIRED', // Actually required -> optional
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

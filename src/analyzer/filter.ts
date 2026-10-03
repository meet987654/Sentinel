import { BreakingChange } from '../types.js';

export interface EndpointFilterOptions {
  includeExactMatchesOnly?: boolean;
  additionalKeywords?: string[];
}

export interface FilterCandidateResult {
  candidateFiles: string[];
  skippedFiles: string[];
  targetRoutes: string[];
  targetProperties: string[];
  stats: {
    totalFiles: number;
    candidateCount: number;
    filteredOutCount: number;
    filterRatio: number;
  };
}

export interface SourceFileContent {
  filePath: string;
  content: string;
}

export interface ExtractedTargets {
  routes: string[];
  properties: string[];
  routeSegments: string[];
}

/**
 * Extracts target API route paths, segments, and property names from BreakingChange payloads.
 */
export function extractEndpointTargets(changes: BreakingChange[]): ExtractedTargets {
  const routesSet = new Set<string>();
  const propertiesSet = new Set<string>();
  const segmentsSet = new Set<string>();

  for (const change of changes) {
    if (!change.path) continue;

    const parts = change.path.split('.');
    const firstPart = parts[0].trim();

    // Check if firstPart contains an HTTP method and route: e.g. "GET /api/v1/members"
    const methodMatch = firstPart.match(/^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\s+(\/[^\s.]*)/i);
    let routePath = '';

    if (methodMatch) {
      routePath = methodMatch[2];
    } else if (firstPart.startsWith('/')) {
      routePath = firstPart;
    }

    if (routePath) {
      routesSet.add(routePath);

      // Clean parameterized segments: "/users/{id}" -> "/users"
      const staticPrefix = routePath.replace(/\/\{[^}]+\}/g, '').replace(/\/$/, '');
      if (staticPrefix && staticPrefix !== routePath) {
        routesSet.add(staticPrefix);
      }

      // Add individual meaningful path segments (min length 3 to avoid noise like "api")
      const segments = routePath.split('/').filter(s => s.length >= 3 && !s.startsWith('{') && s !== 'api');
      for (const seg of segments) {
        segmentsSet.add(seg);
      }
    } else if (firstPart.length > 0 && !firstPart.includes('/')) {
      // Possible schema model name: e.g. "MemberResponse"
      segmentsSet.add(firstPart);
    }

    // Extract property name: last segment of the path
    const lastPart = parts[parts.length - 1].trim();
    if (lastPart && lastPart !== '[]' && isNaN(parseInt(lastPart, 10))) {
      propertiesSet.add(lastPart);
    }
  }

  return {
    routes: Array.from(routesSet),
    properties: Array.from(propertiesSet),
    routeSegments: Array.from(segmentsSet),
  };
}

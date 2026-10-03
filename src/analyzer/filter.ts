import { BreakingChange } from '../types.js';
import { Project } from 'ts-morph';
import { shouldIgnoreFile } from '../config.js';

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

/**
 * Fast-filters a collection of source files using lightweight regex and string matching
 * to isolate candidate files referencing target routes, schema models, or properties.
 */
export function filterCandidateFiles(
  files: SourceFileContent[],
  changes: BreakingChange[],
  options?: EndpointFilterOptions
): FilterCandidateResult {
  const targets = extractEndpointTargets(changes);
  const candidateFiles: string[] = [];
  const skippedFiles: string[] = [];

  // Build regex patterns
  const patterns: RegExp[] = [];

  // 1. Target routes (e.g. "/api/v1/members")
  for (const route of targets.routes) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.push(new RegExp(escaped, 'i'));
  }

  // 2. Target properties with word boundaries (e.g. \buniversity\b)
  for (const prop of targets.properties) {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    patterns.push(new RegExp(`\\b${escaped}\\b`, 'i'));
  }

  // 3. Meaningful route segments or models (e.g. \bmembers\b or \bMemberResponse\b)
  if (!options?.includeExactMatchesOnly) {
    for (const seg of targets.routeSegments) {
      const escaped = seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(new RegExp(`\\b${escaped}\\b`, 'i'));
    }
  }

  if (options?.additionalKeywords) {
    for (const kw of options.additionalKeywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patterns.push(new RegExp(`\\b${escaped}\\b`, 'i'));
    }
  }

  for (const file of files) {
    // If no patterns to search for, keep all files by default
    if (patterns.length === 0) {
      candidateFiles.push(file.filePath);
      continue;
    }

    let isCandidate = false;
    for (const pattern of patterns) {
      if (pattern.test(file.content)) {
        isCandidate = true;
        break;
      }
    }

    if (isCandidate) {
      candidateFiles.push(file.filePath);
    } else {
      skippedFiles.push(file.filePath);
    }
  }

  const totalFiles = files.length;
  const candidateCount = candidateFiles.length;
  const filteredOutCount = skippedFiles.length;
  const filterRatio = totalFiles > 0 ? Math.round((filteredOutCount / totalFiles) * 1000) / 1000 : 0;

  return {
    candidateFiles,
    skippedFiles,
    targetRoutes: targets.routes,
    targetProperties: targets.properties,
    stats: {
      totalFiles,
      candidateCount,
      filteredOutCount,
      filterRatio,
    }
  };
}

/**
 * Filters source files from an in-memory ts-morph Project prior to heavy AST property scanning.
 */
export function filterCandidateFilesFromProject(
  project: Project,
  changes: BreakingChange[],
  options?: EndpointFilterOptions & { ignorePaths?: string[] }
): FilterCandidateResult {
  const files: SourceFileContent[] = [];
  const ignorePaths = options?.ignorePaths || [];

  for (const sourceFile of project.getSourceFiles()) {
    const rawPath = sourceFile.getFilePath();
    const relativePath = rawPath.replace(/\\/g, '/').replace(/^\//, '');

    if (
      relativePath.includes('node_modules') ||
      relativePath.includes('dist') ||
      shouldIgnoreFile(relativePath, ignorePaths)
    ) {
      continue;
    }

    files.push({
      filePath: relativePath,
      content: sourceFile.getFullText(),
    });
  }

  return filterCandidateFiles(files, changes, options);
}


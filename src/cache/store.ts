import crypto from 'crypto';
import { Project } from 'ts-morph';
import { BreakingChange, ConsumerFinding } from '../types.js';
import { shouldIgnoreFile } from '../config.js';
import { analyzeSourceFile } from '../analyzer/tsMorph.js';

export interface CacheKey {
  filePath: string;
  contentHash: string;
  propertyName: string;
  commitSha?: string;
}

export interface CachedFindingsEntry {
  filePath: string;
  contentHash: string;
  propertyName: string;
  commitSha?: string;
  findings: ConsumerFinding[];
  timestamp: number;
}

export interface CacheStore {
  get(key: CacheKey): Promise<CachedFindingsEntry | null>;
  set(key: CacheKey, findings: ConsumerFinding[], ttlMs?: number): Promise<void>;
  has(key: CacheKey): Promise<boolean>;
  invalidate(filePath: string): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

/**
 * Computes a deterministic SHA-256 hash of a file's string contents.
 */
export function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Formats a composite cache key string from CacheKey parameters.
 */
export function buildCacheKeyString(key: CacheKey): string {
  const commit = key.commitSha || 'latest';
  return `${commit}:${key.filePath}:${key.contentHash}:${key.propertyName}`;
}

/**
 * High-performance In-Memory LRU Cache Store for AST analysis findings.
 */
export class MemoryCacheStore implements CacheStore {
  private cache = new Map<string, CachedFindingsEntry>();
  private maxEntries: number;

  constructor(maxEntries: number = 5000) {
    this.maxEntries = maxEntries;
  }

  async get(key: CacheKey): Promise<CachedFindingsEntry | null> {
    const keyStr = buildCacheKeyString(key);
    const entry = this.cache.get(keyStr);
    if (!entry) return null;

    // Refresh LRU order: delete and re-insert
    this.cache.delete(keyStr);
    this.cache.set(keyStr, entry);
    return entry;
  }

  async set(key: CacheKey, findings: ConsumerFinding[], ttlMs?: number): Promise<void> {
    const keyStr = buildCacheKeyString(key);

    // Evict oldest entry if capacity reached
    if (this.cache.size >= this.maxEntries && !this.cache.has(keyStr)) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const entry: CachedFindingsEntry = {
      filePath: key.filePath,
      contentHash: key.contentHash,
      propertyName: key.propertyName,
      commitSha: key.commitSha,
      findings,
      timestamp: Date.now(),
    };

    this.cache.set(keyStr, entry);
  }

  async has(key: CacheKey): Promise<boolean> {
    const keyStr = buildCacheKeyString(key);
    return this.cache.has(keyStr);
  }

  async invalidate(filePath: string): Promise<void> {
    const normalized = filePath.replace(/\\/g, '/');
    for (const [keyStr, entry] of Array.from(this.cache.entries())) {
      if (entry.filePath.replace(/\\/g, '/') === normalized) {
        this.cache.delete(keyStr);
      }
    }
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async size(): Promise<number> {
    return this.cache.size;
  }
}

export interface IncrementalAnalysisOptions {
  commitSha?: string;
  ignorePaths?: string[];
  cacheStore?: CacheStore;
}

export interface IncrementalAnalysisResult {
  findings: ConsumerFinding[];
  stats: {
    totalFiles: number;
    cachedFiles: number;
    analyzedFiles: number;
    cacheHitRatio: number;
    durationMs: number;
  };
}

/**
 * Performs incremental AST property analysis over a Project,
 * skipping unchanged files whose content hash matches the cached state.
 */
export async function analyzeConsumersIncremental(
  project: Project,
  changes: BreakingChange[],
  options?: IncrementalAnalysisOptions
): Promise<IncrementalAnalysisResult> {
  const startTime = performance.now();
  const cacheStore = options?.cacheStore || new MemoryCacheStore();
  const ignorePaths = options?.ignorePaths || [];
  const commitSha = options?.commitSha;

  const propertyNamesToFind = new Map<string, string>();
  for (const change of changes) {
    if (change.type === 'FIELD_REMOVED' || change.type === 'TYPE_CHANGED') {
      const parts = change.path.split('.');
      const propertyName = parts[parts.length - 1];
      if (propertyName !== '[]' && isNaN(parseInt(propertyName, 10))) {
        propertyNamesToFind.set(propertyName, change.path);
      }
    }
  }

  const allFindings: ConsumerFinding[] = [];
  let totalFiles = 0;
  let cachedFiles = 0;
  let analyzedFiles = 0;

  if (propertyNamesToFind.size === 0) {
    return {
      findings: [],
      stats: {
        totalFiles: 0,
        cachedFiles: 0,
        analyzedFiles: 0,
        cacheHitRatio: 0,
        durationMs: 0,
      }
    };
  }

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

    totalFiles++;
    const contentHash = generateContentHash(sourceFile.getFullText());

    // Check cache for this file across all target properties
    let allPropertiesCached = true;
    const fileCachedFindings: ConsumerFinding[] = [];

    for (const propName of propertyNamesToFind.keys()) {
      const key: CacheKey = {
        filePath: relativePath,
        contentHash,
        propertyName: propName,
        commitSha,
      };
      const cached = await cacheStore.get(key);
      if (cached) {
        fileCachedFindings.push(...cached.findings);
      } else {
        allPropertiesCached = false;
        break;
      }
    }

    if (allPropertiesCached) {
      // CACHE HIT: completely bypass ts-morph AST scanning for this file!
      cachedFiles++;
      allFindings.push(...fileCachedFindings);
    } else {
      // CACHE MISS: run fresh AST analysis
      analyzedFiles++;
      const fileFindings = analyzeSourceFile(sourceFile, propertyNamesToFind);
      allFindings.push(...fileFindings);

      // Group findings by propertyName and update cache
      for (const propName of propertyNamesToFind.keys()) {
        const propFindings = fileFindings.filter(f => f.property === propName);
        const key: CacheKey = {
          filePath: relativePath,
          contentHash,
          propertyName: propName,
          commitSha,
        };
        await cacheStore.set(key, propFindings);
      }
    }
  }

  const endTime = performance.now();
  const durationMs = Math.round((endTime - startTime) * 100) / 100;
  const cacheHitRatio = totalFiles > 0 ? Math.round((cachedFiles / totalFiles) * 1000) / 1000 : 0;

  return {
    findings: allFindings,
    stats: {
      totalFiles,
      cachedFiles,
      analyzedFiles,
      cacheHitRatio,
      durationMs,
    }
  };
}


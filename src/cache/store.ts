import crypto from 'crypto';
import { ConsumerFinding } from '../types.js';

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

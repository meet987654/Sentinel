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

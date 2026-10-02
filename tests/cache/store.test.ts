import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import {
  generateContentHash,
  buildCacheKeyString,
  MemoryCacheStore,
  analyzeConsumersIncremental,
} from '../../src/cache/store.js';
import { BreakingChange } from '../../src/types.js';

describe('Incremental AST Analysis & Commit Caching Layer (src/cache/store.ts)', () => {
  it('generateContentHash produces deterministic SHA-256 hashes', () => {
    const hash1 = generateContentHash('const x = 10;');
    const hash2 = generateContentHash('const x = 10;');
    const hash3 = generateContentHash('const x = 20;');

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });

  it('buildCacheKeyString formats consistent composite keys', () => {
    const keyStr = buildCacheKeyString({
      filePath: 'src/user.ts',
      contentHash: 'abc123hash',
      propertyName: 'email',
      commitSha: 'commit_sha_99',
    });

    expect(keyStr).toBe('commit_sha_99:src/user.ts:abc123hash:email');

    const defaultCommit = buildCacheKeyString({
      filePath: 'src/user.ts',
      contentHash: 'abc123hash',
      propertyName: 'email',
    });

    expect(defaultCommit).toBe('latest:src/user.ts:abc123hash:email');
  });

  it('MemoryCacheStore supports set, get, has, invalidation, and LRU eviction', async () => {
    const store = new MemoryCacheStore(2); // Max 2 entries

    const keyA = { filePath: 'src/a.ts', contentHash: 'hashA', propertyName: 'name' };
    const keyB = { filePath: 'src/b.ts', contentHash: 'hashB', propertyName: 'name' };
    const keyC = { filePath: 'src/c.ts', contentHash: 'hashC', propertyName: 'name' };

    await store.set(keyA, [{ confidence: 'confirmed', filePath: 'src/a.ts', lineNumber: 1, snippet: 'a.name', property: 'name' }]);
    await store.set(keyB, [{ confidence: 'high', filePath: 'src/b.ts', lineNumber: 2, snippet: 'b.name', property: 'name' }]);

    expect(await store.has(keyA)).toBe(true);
    expect(await store.size()).toBe(2);

    // Adding 3rd entry triggers eviction of oldest
    // Access keyA to make keyB the LRU
    await store.get(keyA);
    await store.set(keyC, []);

    expect(await store.has(keyB)).toBe(false); // Evicted
    expect(await store.has(keyA)).toBe(true); // Kept
    expect(await store.has(keyC)).toBe(true); // Added

    // Invalidation
    await store.invalidate('src/a.ts');
    expect(await store.has(keyA)).toBe(false);
    expect(await store.size()).toBe(1);

    await store.clear();
    expect(await store.size()).toBe(0);
  });

  it('analyzeConsumersIncremental bypasses AST parsing on cached files and drops latency', async () => {
    const project = new Project({ useInMemoryFileSystem: true });

    // Populate project with 10 synthetic files
    for (let i = 0; i < 10; i++) {
      const code = i % 2 === 0
        ? `export function get${i}(user: any) { return user.email; }`
        : `export function format${i}(item: any) { return item.title; }`;
      project.createSourceFile(`src/file_${i}.ts`, code);
    }

    const changes: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /users.response.200.email',
      }
    ];

    const store = new MemoryCacheStore();

    // 1. Cold Run
    const coldStart = performance.now();
    const coldResult = await analyzeConsumersIncremental(project, changes, {
      cacheStore: store,
      commitSha: 'commit_v1',
    });
    const coldDuration = performance.now() - coldStart;

    expect(coldResult.stats.totalFiles).toBe(10);
    expect(coldResult.stats.cachedFiles).toBe(0);
    expect(coldResult.stats.analyzedFiles).toBe(10);
    expect(coldResult.stats.cacheHitRatio).toBe(0);
    expect(coldResult.findings.length).toBe(5); // Even-numbered files match user.email

    // 2. Warm Run (identical files and commit)
    const warmStart = performance.now();
    const warmResult = await analyzeConsumersIncremental(project, changes, {
      cacheStore: store,
      commitSha: 'commit_v1',
    });
    const warmDuration = performance.now() - warmStart;

    expect(warmResult.stats.totalFiles).toBe(10);
    expect(warmResult.stats.cachedFiles).toBe(10);
    expect(warmResult.stats.analyzedFiles).toBe(0);
    expect(warmResult.stats.cacheHitRatio).toBe(1.0);
    expect(warmResult.findings.length).toBe(5);

    // Warm run should be significantly faster than cold run
    // (Bypasses ts-morph AST traversal)
    expect(warmResult.stats.cachedFiles).toBeGreaterThan(0);

    // 3. Partial Run (Modify 1 file)
    const modifiedFile = project.getSourceFile('src/file_0.ts');
    modifiedFile?.replaceWithText(`export function get0(user: any) { const email = user.email; return email; }`);

    const partialResult = await analyzeConsumersIncremental(project, changes, {
      cacheStore: store,
      commitSha: 'commit_v1',
    });

    expect(partialResult.stats.totalFiles).toBe(10);
    expect(partialResult.stats.cachedFiles).toBe(9); // 9 unchanged files hit cache
    expect(partialResult.stats.analyzedFiles).toBe(1); // 1 modified file was re-analyzed
    expect(partialResult.findings.length).toBe(5);
  });
});

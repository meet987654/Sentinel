import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Project } from 'ts-morph';
import fs from 'fs/promises';
import path from 'path';
import {
  buildDependencyIndex,
  serializeDependencyIndex,
  deserializeDependencyIndex,
  exportDependencyIndexToFile,
  loadDependencyIndexFromFile,
  lookupAffectedFiles,
  DEPENDENCY_INDEX_VERSION,
} from '../../src/cache/indexer.js';

describe('Symbol & Dependency Index Generator (src/cache/indexer.ts)', () => {
  const tempDir = path.resolve('scratch/test-indexer-temp');

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('correctly maps named imports, types, and symbols to source files', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile(
      'src/components/UserProfile.tsx',
      `
      import { UserResponse, fetchUser } from '../api/userClient';
      import type { AuthToken } from '../types';

      export function UserProfile(props: { token: AuthToken }) {
        const user: UserResponse = fetchUser();
        return <div>{user.name}</div>;
      }
    `
    );

    project.createSourceFile(
      'src/pages/Dashboard.tsx',
      `
      import { UserResponse } from '../api/userClient';
      import defaultLogger from '../utils/logger';
      import * as helpers from '../utils/helpers';

      export function Dashboard() {
        defaultLogger("Dashboard loaded");
        return <div>Dashboard</div>;
      }
    `
    );

    const index = buildDependencyIndex(project, { repositoryName: 'acme/frontend' });

    expect(index.version).toBe(DEPENDENCY_INDEX_VERSION);
    expect(index.repository).toBe('acme/frontend');
    expect(index.totalFiles).toBe(2);

    // Types mapping
    expect(index.typeToFiles['UserResponse']).toContain('src/components/UserProfile.tsx');
    expect(index.typeToFiles['UserResponse']).toContain('src/pages/Dashboard.tsx');
    expect(index.typeToFiles['AuthToken']).toContain('src/components/UserProfile.tsx');

    // Symbols mapping
    expect(index.symbolToFiles['fetchUser']).toContain('src/components/UserProfile.tsx');
    expect(index.symbolToFiles['defaultLogger']).toContain('src/pages/Dashboard.tsx');
    expect(index.symbolToFiles['helpers']).toContain('src/pages/Dashboard.tsx');

    // Import records
    expect(index.fileImports['src/components/UserProfile.tsx']).toBeDefined();
    expect(index.fileImports['src/components/UserProfile.tsx'].length).toBe(2);
  });

  it('scans string literals and static template literals for API routes', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile(
      'src/api/userClient.ts',
      `
      export function getUsers() {
        return fetch('/api/v1/users');
      }

      export function getMember(id: string) {
        return fetch(\`/members/\${id}\`);
      }

      export function getRootRoute() {
        return fetch('/api/v1/members');
      }
    `
    );

    const index = buildDependencyIndex(project);

    expect(index.routeToFiles['/api/v1/users']).toContain('src/api/userClient.ts');
    expect(index.routeToFiles['/api/v1/members']).toContain('src/api/userClient.ts');
  });

  it('respects ignorePaths patterns during index building', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile(
      'src/pages/Home.tsx',
      `import { UserResponse } from './api';`
    );

    project.createSourceFile(
      'src/__tests__/Home.test.tsx',
      `import { UserResponse } from '../pages/Home';`
    );

    project.createSourceFile(
      'src/mockData.ts',
      `import { UserResponse } from './api';`
    );

    const index = buildDependencyIndex(project, {
      ignorePaths: ['**/__tests__/**', '**/mockData.ts'],
    });

    expect(index.totalFiles).toBe(1);
    expect(index.typeToFiles['UserResponse']).toEqual(['src/pages/Home.tsx']);
    expect(index.typeToFiles['UserResponse']).not.toContain('src/__tests__/Home.test.tsx');
    expect(index.typeToFiles['UserResponse']).not.toContain('src/mockData.ts');
  });

  it('serializes and deserializes snapshot cleanly to JSON', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile(
      'src/index.ts',
      `import { ConfigType } from './types'; const route = '/health';`
    );

    const index = buildDependencyIndex(project, { repositoryName: 'test-repo' });
    const json = serializeDependencyIndex(index);

    expect(json).toContain('"version": "1.0.0"');
    expect(json).toContain('"repository": "test-repo"');
    expect(json).toContain('"ConfigType"');
    expect(json).toContain('"/health"');

    const deserialized = deserializeDependencyIndex(json);
    expect(deserialized.version).toBe(index.version);
    expect(deserialized.repository).toBe(index.repository);
    expect(deserialized.totalFiles).toBe(index.totalFiles);
    expect(deserialized.typeToFiles).toEqual(index.typeToFiles);
  });

  it('exports to file and reloads dependency index snapshot', async () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/client.ts', `import { ApiClient } from './api';`);

    const index = buildDependencyIndex(project);
    const snapshotPath = path.join(tempDir, 'dependency-index.json');

    await exportDependencyIndexToFile(index, snapshotPath);
    const exists = await fs.stat(snapshotPath);
    expect(exists.isFile()).toBe(true);

    const loaded = await loadDependencyIndexFromFile(snapshotPath);
    expect(loaded.version).toBe(DEPENDENCY_INDEX_VERSION);
    expect(loaded.typeToFiles['ApiClient']).toContain('src/client.ts');
  });

  it('lookupAffectedFiles correctly retrieves matching files by symbol or route', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/users.ts', `import { UserModel } from './types'; const url = '/api/v1/users';`);
    project.createSourceFile('src/orders.ts', `import { OrderModel } from './types'; const url = '/api/v1/orders';`);
    project.createSourceFile('src/common.ts', `import { UserModel } from './types';`);

    const index = buildDependencyIndex(project);

    const userFiles = lookupAffectedFiles(index, ['UserModel']);
    expect(userFiles).toEqual(['src/common.ts', 'src/users.ts']);

    const routeFiles = lookupAffectedFiles(index, ['/api/v1/orders']);
    expect(routeFiles).toEqual(['src/orders.ts']);

    const multiple = lookupAffectedFiles(index, ['UserModel', 'OrderModel']);
    expect(multiple).toEqual(['src/common.ts', 'src/orders.ts', 'src/users.ts']);

    const empty = lookupAffectedFiles(index, ['NonExistentSymbol']);
    expect(empty).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { parseConfig, shouldIgnoreFile, DEFAULT_CONFIG } from '../src/config.js';
import { Project } from 'ts-morph';
import { analyzeConsumersFromProject } from '../src/analyzer/tsMorph.js';
import { BreakingChange } from '../src/types.js';

describe('Repository Configuration Parser (.sentinel.yml)', () => {
  it('should return DEFAULT_CONFIG when input is empty or invalid', () => {
    const emptyConfig = parseConfig();
    expect(emptyConfig.schemaPath).toBe('openapi.yaml');
    expect(emptyConfig.consumers).toEqual(DEFAULT_CONFIG.consumers);
    expect(emptyConfig.ignorePaths).toEqual(expect.arrayContaining(['**/node_modules/**', '**/mockData.ts']));

    const invalidYaml = parseConfig('::: invalid yaml :::');
    expect(invalidYaml.schemaPath).toBe('openapi.yaml');
  });

  it('should parse custom .sentinel.yml configuration options', () => {
    const yamlContent = `
schemaPath: "api/v1/swagger.yaml"
consumers:
  - "apps/web/**/*.tsx"
ignorePaths:
  - "**/legacy/**"
  - "**/mockData.ts"
severityThreshold: "breaking"
`;

    const config = parseConfig(yamlContent);
    expect(config.schemaPath).toBe('api/v1/swagger.yaml');
    expect(config.consumers).toEqual(['apps/web/**/*.tsx']);
    expect(config.ignorePaths).toEqual(expect.arrayContaining(['**/legacy/**', '**/mockData.ts', '**/node_modules/**']));
    expect(config.severityThreshold).toBe('breaking');
  });

  it('should correctly evaluate shouldIgnoreFile glob patterns', () => {
    const ignorePaths = [
      '**/node_modules/**',
      '**/dist/**',
      '**/__tests__/**',
      '**/*.test.ts',
      '**/mockData.ts',
    ];

    expect(shouldIgnoreFile('node_modules/express/index.js', ignorePaths)).toBe(true);
    expect(shouldIgnoreFile('dist/bundle.js', ignorePaths)).toBe(true);
    expect(shouldIgnoreFile('src/__tests__/user.test.ts', ignorePaths)).toBe(true);
    expect(shouldIgnoreFile('src/components/user.test.ts', ignorePaths)).toBe(true);
    expect(shouldIgnoreFile('src/mocks/mockData.ts', ignorePaths)).toBe(true);

    expect(shouldIgnoreFile('src/pages/community.tsx', ignorePaths)).toBe(false);
    expect(shouldIgnoreFile('src/services/apiClient.ts', ignorePaths)).toBe(false);
  });

  it('should exclude ignored files from AST consumer analysis', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    // 1. Regular consumer file
    project.createSourceFile('src/pages/UserProfile.tsx', `
      function UserProfile({ user }: { user: any }) {
        return <div>{user.university}</div>;
      }
    `);

    // 2. Ignored test file
    project.createSourceFile('src/__tests__/user.test.ts', `
      function testUser(user: any) {
        return user.university;
      }
    `);

    // 3. Ignored mock file
    project.createSourceFile('src/mocks/mockData.ts', `
      const mockUser = { university: 'Harvard' };
    `);

    const changes: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'MemberResponse.university',
      }
    ];

    const ignorePaths = ['**/__tests__/**', '**/mockData.ts'];
    const findings = analyzeConsumersFromProject(project, changes, ignorePaths);

    // Only src/pages/UserProfile.tsx should be flagged
    expect(findings).toHaveLength(1);
    expect(findings[0].filePath).toBe('src/pages/UserProfile.tsx');
    expect(findings[0].property).toBe('university');
  });
});

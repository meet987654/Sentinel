import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { analyzeConsumersFromProject } from '../../src/analyzer/tsMorph.js';
import { BreakingChange } from '../../src/types.js';

describe('ts-morph Consumer Analyzer', () => {
  it('should detect medium-confidence property accesses for removed fields', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    
    // Create a mock source file with an expected usage
    project.createSourceFile('src/components/Profile.tsx', `
      function Profile({ user }) {
        return <div>{user.email}</div>;
      }
    `);

    // Create a mock source file with no expected usages
    project.createSourceFile('src/components/Other.tsx', `
      function Other() {
        return <div>hello</div>;
      }
    `);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /users.response.200.email', // The field name 'email' is at the end of the path
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      confidence: 'medium',
      filePath: 'src/components/Profile.tsx',
      property: 'email',
    });
    expect(findings[0].snippet).toContain('{user.email}');
  });

  it('should ignore array markers and status codes when extracting property names', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    
    // Mock code that uses a variable called '200' or similar (not typical but edge case)
    project.createSourceFile('src/test.ts', `
      const obj = { '200': 'ok' };
      console.log(obj['200']);
    `);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /users.response.200', // Path ends in 200
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    // Should not flag property '200' as it's filtered out
    expect(findings).toHaveLength(0);
  });
});

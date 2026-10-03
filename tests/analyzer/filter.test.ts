import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import {
  extractEndpointTargets,
  filterCandidateFiles,
  filterCandidateFilesFromProject,
} from '../../src/analyzer/filter.js';
import { BreakingChange } from '../../src/types.js';

describe('Target Endpoint Consumer Filter (src/analyzer/filter.ts)', () => {
  it('extracts endpoint routes, segments, and property names correctly', () => {
    const changes: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /api/v1/members/{id}.response.200.university',
      },
      {
        type: 'TYPE_CHANGED',
        severity: 'breaking',
        path: 'POST /users.requestBody.email',
      },
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'UserResponse.avatarUrl',
      }
    ];

    const targets = extractEndpointTargets(changes);

    // Routes
    expect(targets.routes).toContain('/api/v1/members/{id}');
    expect(targets.routes).toContain('/api/v1/members');
    expect(targets.routes).toContain('/users');

    // Segments and models
    expect(targets.routeSegments).toContain('members');
    expect(targets.routeSegments).toContain('users');
    expect(targets.routeSegments).toContain('UserResponse');

    // Properties
    expect(targets.properties).toContain('university');
    expect(targets.properties).toContain('email');
    expect(targets.properties).toContain('avatarUrl');
  });

  it('filterCandidateFiles isolates candidate files and skips irrelevant files', () => {
    const changes: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /api/v1/members.response.200.university',
      }
    ];

    const files = [
      {
        filePath: 'src/pages/community.tsx',
        content: `export function Community() { const url = '/api/v1/members'; return url; }`,
      },
      {
        filePath: 'src/components/MemberCard.tsx',
        content: `export function MemberCard({ member }: any) { return <div>{member.university}</div>; }`,
      },
      {
        filePath: 'src/services/billing.ts',
        content: `export function processInvoice(invoice: any) { return invoice.totalAmount; }`,
      },
      {
        filePath: 'src/utils/math.ts',
        content: `export function add(a: number, b: number) { return a + b; }`,
      }
    ];

    const result = filterCandidateFiles(files, changes);

    expect(result.candidateFiles).toContain('src/pages/community.tsx');
    expect(result.candidateFiles).toContain('src/components/MemberCard.tsx');
    expect(result.skippedFiles).toContain('src/services/billing.ts');
    expect(result.skippedFiles).toContain('src/utils/math.ts');

    expect(result.stats.totalFiles).toBe(4);
    expect(result.stats.candidateCount).toBe(2);
    expect(result.stats.filteredOutCount).toBe(2);
    expect(result.stats.filterRatio).toBe(0.5);
  });

  it('filterCandidateFilesFromProject respects ignorePaths and isolates candidates from Project', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile(
      'src/pages/Members.tsx',
      `export function Members() { return fetch('/api/v1/members'); }`
    );

    project.createSourceFile(
      'src/__tests__/Members.test.tsx',
      `export function testMembers() { return fetch('/api/v1/members'); }`
    );

    project.createSourceFile(
      'src/services/auth.ts',
      `export function login(credentials: any) { return credentials.token; }`
    );

    const changes: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /api/v1/members.response.200.university',
      }
    ];

    const result = filterCandidateFilesFromProject(project, changes, {
      ignorePaths: ['**/__tests__/**'],
    });

    // Ignored test file should not even be counted
    expect(result.stats.totalFiles).toBe(2);
    expect(result.candidateFiles).toEqual(['src/pages/Members.tsx']);
    expect(result.skippedFiles).toEqual(['src/services/auth.ts']);
  });

  it('handles empty changes or empty files gracefully', () => {
    const result1 = filterCandidateFiles([], []);
    expect(result1.stats.totalFiles).toBe(0);
    expect(result1.candidateFiles).toHaveLength(0);

    const result2 = filterCandidateFiles(
      [{ filePath: 'src/app.ts', content: 'console.log("hello");' }],
      []
    );
    // If no breaking changes, all files kept by default
    expect(result2.candidateFiles).toContain('src/app.ts');
  });
});

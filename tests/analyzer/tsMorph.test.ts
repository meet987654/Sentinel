import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { analyzeConsumersFromProject } from '../../src/analyzer/tsMorph.js';
import { BreakingChange } from '../../src/types.js';

describe('ts-morph Consumer Analyzer', () => {
  it('should detect medium-confidence property accesses for untyped removed fields', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    
    // Create a mock source file with an expected usage
    project.createSourceFile('src/components/Profile.tsx', `
      function Profile({ user }: { user: any }) {
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

  it('should mark symbol-resolved property accesses as confirmed confidence', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/types/api.ts', `
      export interface UserResponse {
        id: string;
        email: string;
      }
    `);

    project.createSourceFile('src/components/UserProfile.tsx', `
      import { UserResponse } from '../types/api';

      export function UserProfile({ user }: { user: UserResponse }) {
        return <div>{user.email}</div>;
      }
    `);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /users.response.200.email',
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      confidence: 'confirmed',
      filePath: 'src/components/UserProfile.tsx',
      property: 'email',
    });
  });

  it('should detect destructured property assignments in variable declarations', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/types/api.ts', `
      export interface MemberResponse {
        id: string;
        university: string;
      }
    `);

    project.createSourceFile('src/pages/community.tsx', `
      import { MemberResponse } from '../types/api';

      export function CommunityPage(res: MemberResponse) {
        const { university } = res;
        return <div>{university}</div>;
      }
    `);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'Member.university',
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      confidence: 'confirmed',
      filePath: 'src/pages/community.tsx',
      property: 'university',
    });
    expect(findings[0].snippet).toContain('const { university } = res;');
  });

  it('should detect nested and aliased destructuring', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/types/api.ts', `
      export interface MemberResponse {
        profile: {
          university: string;
        };
      }
    `);

    project.createSourceFile('src/components/MemberRow.tsx', `
      import { MemberResponse } from '../types/api';

      export function MemberRow({ res }: { res: MemberResponse }) {
        const { profile: { university: uni } } = res;
        return <div>{uni}</div>;
      }
    `);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'Member.university',
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      filePath: 'src/components/MemberRow.tsx',
      property: 'university',
    });
  });

  it('should detect destructured function parameter declarations', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/types/api.ts', `
      export interface MemberResponse {
        university: string;
      }
    `);

    project.createSourceFile('src/components/Card.tsx', `
      import { MemberResponse } from '../types/api';

      export function Card({ university }: MemberResponse) {
        return <div>{university}</div>;
      }
    `);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'Member.university',
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      confidence: 'confirmed',
      filePath: 'src/components/Card.tsx',
      property: 'university',
    });
  });

  it('should detect property accesses inside array iterator callbacks (map, filter, reduce)', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/types/api.ts', `
      export interface MemberResponse {
        id: string;
        university: string;
      }
    `);

    project.createSourceFile('src/components/MemberList.tsx', `
      import { MemberResponse } from '../types/api';

      export function MemberList({ members }: { members: MemberResponse[] }) {
        return (
          <div>
            {members.map((member) => (
              <div key={member.id}>{member.university}</div>
            ))}
          </div>
        );
      }
    `);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'Member.university',
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      confidence: 'confirmed',
      filePath: 'src/components/MemberList.tsx',
      property: 'university',
    });
    expect(findings[0].snippet).toContain('member.university');
  });

  it('should trace property access passed as function arguments with line precision', () => {
    const project = new Project({ useInMemoryFileSystem: true });

    project.createSourceFile('src/types/api.ts', `
      export interface MemberResponse {
        university: string;
      }
    `);

    project.createSourceFile('src/utils/format.ts', `import { MemberResponse } from '../types/api';

function formatUni(name: string) { return name.toUpperCase(); }

export function processMember(member: MemberResponse) {
  const result = formatUni(
    member.university
  );
  return result;
}`);

    const breakingChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'Member.university',
      }
    ];

    const findings = analyzeConsumersFromProject(project, breakingChanges);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      confidence: 'confirmed',
      filePath: 'src/utils/format.ts',
      property: 'university',
      lineNumber: 7,
    });
    expect(findings[0].snippet).toContain('member.university');
  });

  it('should ignore array markers and status codes when extracting property names', () => {
    const project = new Project({ useInMemoryFileSystem: true });
    
    // Mock code that uses a variable called '200' or similar
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

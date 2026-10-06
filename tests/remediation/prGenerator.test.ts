import { describe, it, expect, vi } from 'vitest';
import {
  applyPropertyRename,
  transformConsumerFiles,
  createRemediationPR,
  PropertyRenameRule,
} from '../../src/remediation/prGenerator.js';

describe('Automated Remediation Pull Request Generator', () => {
  describe('applyPropertyRename', () => {
    it('renames property access expressions using ts-morph AST', () => {
      const code = `
        export function getUserProfile(user: any) {
          const u = user.university;
          console.log(user.university);
          return user.name;
        }
      `;

      const { updatedCode, replacementCount } = applyPropertyRename(code, 'university', 'college');
      expect(replacementCount).toBe(2);
      expect(updatedCode).toContain('user.college');
      expect(updatedCode).not.toContain('user.university');
      expect(updatedCode).toContain('user.name'); // unchanged
    });

    it('renames object destructuring binding elements', () => {
      const code = `
        const { university, email } = userResponse;
        console.log(university);
      `;

      const { updatedCode, replacementCount } = applyPropertyRename(code, 'university', 'college');
      expect(replacementCount).toBe(1);
      expect(updatedCode).toContain('college');
      expect(updatedCode).toContain('email');
    });

    it('returns original code if target property is not present', () => {
      const code = 'const count = 42; const title = "Dashboard";';
      const { updatedCode, replacementCount } = applyPropertyRename(code, 'university', 'college');
      expect(replacementCount).toBe(0);
      expect(updatedCode).toBe(code);
    });
  });

  describe('transformConsumerFiles', () => {
    it('transforms only files containing target properties', () => {
      const files = [
        {
          filePath: 'src/components/UserCard.tsx',
          content: 'export const Card = ({ user }) => <div>{user.university}</div>;',
        },
        {
          filePath: 'src/utils/math.ts',
          content: 'export const add = (a: number, b: number) => a + b;',
        },
      ];

      const rules: PropertyRenameRule[] = [
        { targetProperty: 'university', replacementProperty: 'college' },
      ];

      const transformed = transformConsumerFiles(files, rules);
      expect(transformed).toHaveLength(1);
      expect(transformed[0].filePath).toBe('src/components/UserCard.tsx');
      expect(transformed[0].transformedContent).toContain('{user.college}');
      expect(transformed[0].replacementsCount).toBe(1);
    });
  });

  describe('createRemediationPR', () => {
    const files = [
      {
        filePath: 'src/views/Profile.tsx',
        content: 'const uni = user.university;',
      },
    ];

    const rules: PropertyRenameRule[] = [
      { targetProperty: 'university', replacementProperty: 'college' },
    ];

    it('executes in dry-run mode without requiring live Octokit API calls', async () => {
      const result = await createRemediationPR(files, rules, {
        repoOwner: 'acme-corp',
        repoName: 'web-consumer',
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.isDryRun).toBe(true);
      expect(result.transformedFiles).toHaveLength(1);
      expect(result.branchName).toBe('sentinel/fix-university-to-college');
      expect(result.prNumber).toBe(999);
    });

    it('creates branches, commits file changes, and opens a Draft PR with mock Octokit', async () => {
      const mockOctokit = {
        rest: {
          git: {
            getRef: vi.fn().mockResolvedValue({
              data: { object: { sha: 'base_commit_sha_123' } },
            }),
            createRef: vi.fn().mockResolvedValue({}),
          },
          repos: {
            getContent: vi.fn().mockResolvedValue({
              data: { sha: 'existing_file_sha_456' },
            }),
            createOrUpdateFileContents: vi.fn().mockResolvedValue({}),
          },
          pulls: {
            create: vi.fn().mockResolvedValue({
              data: {
                number: 101,
                html_url: 'https://github.com/acme-corp/web-consumer/pull/101',
              },
            }),
          },
        },
      };

      const result = await createRemediationPR(files, rules, {
        octokit: mockOctokit,
        repoOwner: 'acme-corp',
        repoName: 'web-consumer',
        providerPrNumber: 42,
        isDraft: true,
      });

      expect(result.success).toBe(true);
      expect(result.isDryRun).toBe(false);
      expect(result.prNumber).toBe(101);
      expect(result.prUrl).toBe('https://github.com/acme-corp/web-consumer/pull/101');

      // Verify Octokit API interactions
      expect(mockOctokit.rest.git.getRef).toHaveBeenCalledWith({
        owner: 'acme-corp',
        repo: 'web-consumer',
        ref: 'heads/main',
      });
      expect(mockOctokit.rest.git.createRef).toHaveBeenCalledOnce();
      expect(mockOctokit.rest.repos.createOrUpdateFileContents).toHaveBeenCalledOnce();
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'acme-corp',
          repo: 'web-consumer',
          draft: true,
          head: 'sentinel/fix-university-to-college',
          base: 'main',
        })
      );
    });

    it('handles Octokit API errors gracefully without throwing unhandled exceptions', async () => {
      const mockOctokit = {
        rest: {
          git: {
            getRef: vi.fn().mockRejectedValue(new Error('GitHub 403 Forbidden')),
          },
        },
      };

      const result = await createRemediationPR(files, rules, {
        octokit: mockOctokit,
        repoOwner: 'acme-corp',
        repoName: 'web-consumer',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('GitHub 403 Forbidden');
    });
  });
});

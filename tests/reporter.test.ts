import { describe, it, expect, vi } from 'vitest';
import { createOrUpdateComment, createCheckRun, formatComment, formatCheckRunSummary, buildGitHubFileLineLink, SENTINEL_SIGNATURE_TAG } from '../src/github/reporter.js';
import { ChangeReport } from '../src/types.js';

describe('In-Place PR Comment Threading & Delta Updates (reporter.ts)', () => {
  it('should include hidden HTML signature tag at the top of markdown comments', () => {
    const mockReport: ChangeReport = {
      changes: [],
      findings: [],
      summary: 'No breaking changes.',
    };

    const markdown = formatComment(mockReport);
    expect(markdown).toContain(SENTINEL_SIGNATURE_TAG);
    expect(markdown.startsWith('<!-- sentinel-impact-report -->')).toBe(true);
  });

  it('should append ISO timestamp footer when timestamp argument is provided', () => {
    const mockReport: ChangeReport = {
      changes: [
        {
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: 'MemberResponse.university',
        }
      ],
      findings: [],
      summary: 'Breaking change detected.',
    };

    const timestamp = '2026-09-27T14:00:00.000Z';
    const markdown = formatComment(mockReport, timestamp);
    expect(markdown).toContain(`*Last updated by Sentinel at: \`${timestamp}\`*`);
  });

  it('should call updateComment in-place when existing Sentinel comment is found', async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn().mockResolvedValue({
            data: [
              { id: 101, body: 'Random bot comment' },
              { id: 202, body: '<!-- sentinel-impact-report -->\n## 🛡️ Sentinel — API Contract Check' }
            ]
          }),
          updateComment: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({}),
        }
      }
    };

    const mockReport: ChangeReport = {
      changes: [],
      findings: [],
      summary: '',
    };

    await createOrUpdateComment(mockOctokit, 'owner', 'repo', 12, mockReport);

    expect(mockOctokit.rest.issues.listComments).toHaveBeenCalledWith({
      owner: 'owner',
      repo: 'repo',
      issue_number: 12,
    });

    expect(mockOctokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        comment_id: 202,
        body: expect.stringContaining(SENTINEL_SIGNATURE_TAG),
      })
    );

    expect(mockOctokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it('should call createComment when no existing Sentinel comment is found', async () => {
    const mockOctokit = {
      rest: {
        issues: {
          listComments: vi.fn().mockResolvedValue({ data: [] }),
          updateComment: vi.fn().mockResolvedValue({}),
          createComment: vi.fn().mockResolvedValue({}),
        }
      }
    };

    const mockReport: ChangeReport = {
      changes: [],
      findings: [],
      summary: '',
    };

    await createOrUpdateComment(mockOctokit, 'owner', 'repo', 15, mockReport);

    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        issue_number: 15,
        body: expect.stringContaining(SENTINEL_SIGNATURE_TAG),
      })
    );

    expect(mockOctokit.rest.issues.updateComment).not.toHaveBeenCalled();
  });
});

describe('GitHub Check Run Rich Annotations & Summary Badges (createCheckRun)', () => {
  it('should format rich markdown summary metric tables in formatCheckRunSummary', () => {
    const mockReport: ChangeReport = {
      changes: [
        {
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: 'MemberResponse.university',
        }
      ],
      findings: [
        {
          confidence: 'confirmed',
          filePath: 'src/pages/community.tsx',
          lineNumber: 67,
          snippet: 'member.university',
          property: 'university',
        }
      ],
      summary: 'Breaking change evidence summary.',
    };

    const summaryMarkdown = formatCheckRunSummary(mockReport, 'api/openapi.yaml');
    expect(summaryMarkdown).toContain('## 🛡️ Sentinel API Impact Check Summary');
    expect(summaryMarkdown).toContain('| ⚠️ **Breaking Schema Changes** | `1` | ❌ Failure |');
    expect(summaryMarkdown).toContain('| 🎯 **Confirmed Consumer Usages** | `1` | 🚨 High Impact |');
    expect(summaryMarkdown).toContain('`api/openapi.yaml`');
    expect(summaryMarkdown).toContain('src/pages/community.tsx:67');
  });

  it('should construct failure check run with both spec and consumer annotations', async () => {
    const mockOctokit = {
      rest: {
        checks: {
          create: vi.fn().mockResolvedValue({}),
        }
      }
    };

    const mockReport: ChangeReport = {
      changes: [
        {
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: 'GET /members.response.200.university',
        }
      ],
      findings: [
        {
          confidence: 'confirmed',
          filePath: 'src/pages/community.tsx',
          lineNumber: 67,
          snippet: 'member.university',
          property: 'university',
        }
      ],
      summary: 'Schema change summary.',
    };

    await createCheckRun(mockOctokit, 'owner', 'repo', 'head_sha_123', mockReport, 'openapi.yaml', 'paths:\n  /members:');

    expect(mockOctokit.rest.checks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner',
        repo: 'repo',
        name: 'Sentinel API Check',
        head_sha: 'head_sha_123',
        status: 'completed',
        conclusion: 'failure',
        output: expect.objectContaining({
          title: expect.stringContaining('1 Breaking API Contract Change(s)'),
          summary: expect.stringContaining('Sentinel API Impact Check Summary'),
          annotations: expect.arrayContaining([
            expect.objectContaining({
              path: 'openapi.yaml',
              annotation_level: 'failure',
            }),
            expect.objectContaining({
              path: 'src/pages/community.tsx',
              start_line: 67,
              annotation_level: 'warning',
            })
          ]),
        })
      })
    );
  });
});

describe('Aggregated Multi-Repo Impact Report Generator', () => {
  it('buildGitHubFileLineLink constructs direct github file line URLs', () => {
    const linkWithOrg = buildGitHubFileLineLink('src/pages/community.tsx', 67, 'acme-corp/web-frontend', 'a1b2c3d');
    expect(linkWithOrg).toBe('[`src/pages/community.tsx:67`](https://github.com/acme-corp/web-frontend/blob/a1b2c3d/src/pages/community.tsx#L67)');

    const linkWithDefaultOwner = buildGitHubFileLineLink('src/utils.ts', 12, 'admin-dashboard', 'head123', 'acme-corp');
    expect(linkWithDefaultOwner).toBe('[`src/utils.ts:12`](https://github.com/acme-corp/admin-dashboard/blob/head123/src/utils.ts#L12)');

    const fallbackLink = buildGitHubFileLineLink('src/index.ts', 5);
    expect(fallbackLink).toBe('`src/index.ts:5`');
  });

  it('groups findings across multiple repositories into collapsible HTML details blocks', () => {
    const mockReport: ChangeReport = {
      changes: [
        {
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: 'GET /members.response.200.university',
        }
      ],
      findings: [
        {
          confidence: 'confirmed',
          filePath: 'src/pages/community.tsx',
          lineNumber: 67,
          snippet: 'member.university',
          property: 'university',
          repositoryName: 'acme-corp/web-frontend',
          commitSha: 'sha111',
        },
        {
          confidence: 'high',
          filePath: 'src/components/MemberRow.tsx',
          lineNumber: 31,
          snippet: 'row.university',
          property: 'university',
          repositoryName: 'acme-corp/admin-dashboard',
          commitSha: 'sha222',
        },
        {
          confidence: 'medium',
          filePath: 'src/screens/Profile.tsx',
          lineNumber: 88,
          snippet: 'user.university',
          property: 'university',
          repositoryName: 'acme-corp/web-frontend',
          commitSha: 'sha111',
        }
      ],
      summary: 'Aggregated cross-repo impact analysis.',
    };

    const markdown = formatComment(mockReport);

    expect(markdown).toContain('### 🔍 Multi-Repository Consumer Impact');
    expect(markdown).toContain('> **Total Detected Usages**: `3` across `2` consumer repositories.');

    // Collapsible details blocks
    expect(markdown).toContain('<details>');
    expect(markdown).toContain('<summary><strong>📦 acme-corp/web-frontend</strong> (2 detected usages)</summary>');
    expect(markdown).toContain('<summary><strong>📦 acme-corp/admin-dashboard</strong> (1 detected usage)</summary>');

    // Deep markdown links
    expect(markdown).toContain('[`src/pages/community.tsx:67`](https://github.com/acme-corp/web-frontend/blob/sha111/src/pages/community.tsx#L67)');
    expect(markdown).toContain('[`src/components/MemberRow.tsx:31`](https://github.com/acme-corp/admin-dashboard/blob/sha222/src/components/MemberRow.tsx#L31)');
  });

  it('renders repository permission warnings cleanly when repo access was denied', () => {
    const mockReport: ChangeReport = {
      changes: [
        {
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: 'GET /users.response.200.email',
        }
      ],
      findings: [
        {
          confidence: 'confirmed',
          filePath: 'src/app.ts',
          lineNumber: 10,
          snippet: 'user.email',
          property: 'email',
          repositoryName: 'acme-corp/public-service',
        }
      ],
      repoStatuses: [
        {
          repositoryName: 'acme-corp/public-service',
          status: 'analyzed',
          findingCount: 1,
        },
        {
          repositoryName: 'acme-corp/private-consumer',
          status: 'permission_denied',
          message: 'Unable to determine (Permission Denied)',
        }
      ]
    };

    const markdown = formatComment(mockReport);
    expect(markdown).toContain('#### 🔒 Organization Repository Access & Permissions');
    expect(markdown).toContain('- **acme-corp/private-consumer**: `Unable to determine (Permission Denied)`');
  });

  it('formats check run summary with multi-repo count metric', () => {
    const mockReport: ChangeReport = {
      changes: [
        {
          type: 'FIELD_REMOVED',
          severity: 'breaking',
          path: 'GET /orders.response.200.id',
        }
      ],
      findings: [
        {
          confidence: 'confirmed',
          filePath: 'src/orders.ts',
          lineNumber: 15,
          snippet: 'order.id',
          property: 'id',
          repositoryName: 'acme-corp/orders-ui',
        }
      ]
    };

    const summary = formatCheckRunSummary(mockReport);
    expect(summary).toContain('| 📦 **Consumer Repositories** | `1` | 🌐 Multi-Repo |');
    expect(summary).toContain('[acme-corp/orders-ui] `src/orders.ts:15`');
  });
});


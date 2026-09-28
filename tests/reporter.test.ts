import { describe, it, expect, vi } from 'vitest';
import { createOrUpdateComment, createCheckRun, formatComment, formatCheckRunSummary, SENTINEL_SIGNATURE_TAG } from '../src/github/reporter.js';
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


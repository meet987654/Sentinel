import { describe, it, expect, vi } from 'vitest';
import { createOrUpdateComment, formatComment, SENTINEL_SIGNATURE_TAG } from '../src/github/reporter.js';
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

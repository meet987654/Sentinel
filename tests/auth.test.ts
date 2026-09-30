import { describe, it, expect, vi } from 'vitest';
import { getConsumerRepoOctokit, isPermissionError, PERMISSION_DENIED_MESSAGE } from '../src/github/auth.js';

describe('Multi-Repo App Permissions & Installation Token Manager', () => {
  it('correctly identifies permission and not-found errors', () => {
    expect(isPermissionError({ status: 404 })).toBe(true);
    expect(isPermissionError({ status: 403 })).toBe(true);
    expect(isPermissionError({ statusCode: 404 })).toBe(true);
    expect(isPermissionError({ statusCode: 403 })).toBe(true);
    expect(isPermissionError({ response: { status: 404 } })).toBe(true);
    expect(isPermissionError({ status: 500 })).toBe(false);
    expect(isPermissionError({ status: 401 })).toBe(false);
    expect(isPermissionError(null)).toBe(false);
  });

  it('successfully generates repository-scoped token and Octokit client for consumer repository', async () => {
    const mockInstallationId = 12345;
    const mockToken = 'ghs_scoped_token_mock_999';

    const mockAppOctokit = {
      rest: {
        apps: {
          getRepoInstallation: vi.fn().mockResolvedValue({
            data: { id: mockInstallationId },
          }),
        },
      },
    };

    const mockAuthFn = vi.fn().mockResolvedValue({
      token: mockToken,
    });

    const result = await getConsumerRepoOctokit('acme-corp', 'consumer-dashboard', {
      appOctokit: mockAppOctokit,
      auth: mockAuthFn,
    });

    expect(result.status).toBe('authorized');
    expect(result.installationId).toBe(mockInstallationId);
    expect(result.token).toBe(mockToken);
    expect(result.octokit).toBeDefined();

    expect(mockAppOctokit.rest.apps.getRepoInstallation).toHaveBeenCalledWith({
      owner: 'acme-corp',
      repo: 'consumer-dashboard',
    });

    expect(mockAuthFn).toHaveBeenCalledWith({
      type: 'installation',
      installationId: mockInstallationId,
      repositoryNames: ['consumer-dashboard'],
      permissions: { contents: 'read' },
    });
  });

  it('handles 404 Not Found (app not installed) gracefully with permission warning', async () => {
    const mockAppOctokit = {
      rest: {
        apps: {
          getRepoInstallation: vi.fn().mockRejectedValue({
            status: 404,
            message: 'Not Found',
          }),
        },
      },
    };

    const result = await getConsumerRepoOctokit('acme-corp', 'private-uninstalled-repo', {
      appOctokit: mockAppOctokit,
    });

    expect(result.status).toBe('permission_denied');
    expect(result.octokit).toBeNull();
    expect(result.errorMessage).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it('handles 403 Forbidden (permission denied) gracefully with permission warning', async () => {
    const mockAppOctokit = {
      rest: {
        apps: {
          getRepoInstallation: vi.fn().mockRejectedValue({
            status: 403,
            message: 'Resource not accessible by integration',
          }),
        },
      },
    };

    const result = await getConsumerRepoOctokit('acme-corp', 'forbidden-repo', {
      appOctokit: mockAppOctokit,
    });

    expect(result.status).toBe('permission_denied');
    expect(result.octokit).toBeNull();
    expect(result.errorMessage).toBe(PERMISSION_DENIED_MESSAGE);
  });

  it('handles unexpected errors gracefully without unhandled rejection', async () => {
    const mockAppOctokit = {
      rest: {
        apps: {
          getRepoInstallation: vi.fn().mockRejectedValue(new Error('Network connection reset')),
        },
      },
    };

    const result = await getConsumerRepoOctokit('acme-corp', 'error-repo', {
      appOctokit: mockAppOctokit,
    });

    expect(result.status).toBe('error');
    expect(result.octokit).toBeNull();
    expect(result.errorMessage).toBe('Network connection reset');
  });

  it('returns clean error if credentials are missing and no appClient is provided', async () => {
    const originalAppId = process.env.APP_ID;
    const originalPrivateKey = process.env.PRIVATE_KEY;
    delete process.env.APP_ID;
    delete process.env.PRIVATE_KEY;

    try {
      const result = await getConsumerRepoOctokit('acme-corp', 'no-credentials-repo');
      expect(result.status).toBe('error');
      expect(result.octokit).toBeNull();
      expect(result.errorMessage).toContain('Missing APP_ID or PRIVATE_KEY');
    } finally {
      process.env.APP_ID = originalAppId;
      process.env.PRIVATE_KEY = originalPrivateKey;
    }
  });
});

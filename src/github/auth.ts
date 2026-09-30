import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from 'octokit';

export const PERMISSION_DENIED_MESSAGE = 'Unable to determine (Permission Denied)';

export type ConsumerRepoAuthStatus = 'authorized' | 'permission_denied' | 'error';

export interface ConsumerRepoAuthResult {
  octokit: Octokit | null;
  status: ConsumerRepoAuthStatus;
  token?: string;
  installationId?: number;
  errorMessage?: string;
}

export interface ConsumerAuthOptions {
  appId?: string | number;
  privateKey?: string;
  appOctokit?: any;
  auth?: any;
  permissions?: Record<string, string>;
}

/**
 * Check if a thrown error represents a 403 Forbidden or 404 Not Found (permission/installation issue)
 */
export function isPermissionError(error: any): boolean {
  const status = error?.status || error?.statusCode || error?.response?.status;
  return status === 403 || status === 404;
}

/**
 * Obtains an authenticated Octokit instance scoped specifically to a target consumer repository.
 * Handles missing installations and permission errors (403/404) gracefully without throwing unhandled rejections.
 */
export async function getConsumerRepoOctokit(
  owner: string,
  repo: string,
  options?: ConsumerAuthOptions
): Promise<ConsumerRepoAuthResult> {
  const rawAppId = options?.appId ?? process.env.APP_ID;
  const rawPrivateKey = options?.privateKey ?? process.env.PRIVATE_KEY;

  const normalizedPrivateKey = rawPrivateKey ? rawPrivateKey.replace(/\\n/g, '\n') : '';

  try {
    let appClient = options?.appOctokit;
    let authFn = options?.auth;

    if (!appClient || !authFn) {
      if (!rawAppId || isNaN(Number(rawAppId)) || !normalizedPrivateKey) {
        if (!appClient) {
          return {
            octokit: null,
            status: 'error',
            errorMessage: 'Missing APP_ID or PRIVATE_KEY credentials',
          };
        }
      } else {
        const appIdNum = Number(rawAppId);
        if (!authFn) {
          authFn = createAppAuth({
            appId: appIdNum,
            privateKey: normalizedPrivateKey,
          });
        }
        if (!appClient) {
          appClient = new Octokit({
            authStrategy: createAppAuth,
            auth: {
              appId: appIdNum,
              privateKey: normalizedPrivateKey,
            },
          });
        }
      }
    }

    // 1. Fetch repo-specific installation
    const { data: installation } = await appClient.rest.apps.getRepoInstallation({
      owner,
      repo,
    });

    if (!installation?.id) {
      return {
        octokit: null,
        status: 'permission_denied',
        errorMessage: PERMISSION_DENIED_MESSAGE,
      };
    }

    // 2. Generate repository-scoped access token
    let token: string | undefined;

    if (authFn) {
      const installationAuth = await authFn({
        type: 'installation',
        installationId: installation.id,
        repositoryNames: [repo],
        permissions: options?.permissions || { contents: 'read' },
      });
      token = installationAuth?.token;
    }

    const consumerOctokit = token ? new Octokit({ auth: token }) : appClient;

    return {
      octokit: consumerOctokit,
      status: 'authorized',
      token,
      installationId: installation.id,
    };
  } catch (error: any) {
    if (isPermissionError(error)) {
      console.warn(`[Sentinel Auth] Permission denied or app not installed on repository ${owner}/${repo}`);
      return {
        octokit: null,
        status: 'permission_denied',
        errorMessage: PERMISSION_DENIED_MESSAGE,
      };
    }

    console.error(`[Sentinel Auth] Unexpected authentication failure for repository ${owner}/${repo}:`, error?.message || error);
    return {
      octokit: null,
      status: 'error',
      errorMessage: error?.message || 'Authentication error',
    };
  }
}

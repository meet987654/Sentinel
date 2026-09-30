import { describe, it, expect, vi } from 'vitest';
import { discoverConsumerRepos, fetchConsumerSourceTree } from '../src/discovery/multiRepo.js';

describe('Organization-Wide Consumer Repository Discovery Engine (multiRepo.ts)', () => {
  it('should discover organization repositories tagged with sentinel-consumer topic', async () => {
    const mockOctokit = {
      rest: {
        search: {
          repos: vi.fn().mockResolvedValue({
            data: {
              items: [
                {
                  name: 'web-frontend',
                  owner: { login: 'my-org' },
                  default_branch: 'main',
                  topics: ['sentinel-consumer', 'react'],
                },
                {
                  name: 'mobile-app',
                  owner: { login: 'my-org' },
                  default_branch: 'develop',
                  topics: ['sentinel-consumer', 'react-native'],
                }
              ]
            }
          })
        },
        repos: {
          listForOrg: vi.fn().mockResolvedValue({ data: [] }),
        }
      }
    };

    const repos = await discoverConsumerRepos(mockOctokit, 'my-org', 'sentinel-consumer');

    expect(repos).toHaveLength(2);
    expect(repos[0]).toMatchObject({
      name: 'web-frontend',
      owner: 'my-org',
      defaultBranch: 'main',
    });
    expect(repos[1]).toMatchObject({
      name: 'mobile-app',
      owner: 'my-org',
      defaultBranch: 'develop',
    });
  });

  it('should fallback to listForOrg if topic search fails', async () => {
    const mockOctokit = {
      rest: {
        search: {
          repos: vi.fn().mockRejectedValue(new Error('Search rate limit exceeded')),
        },
        repos: {
          listForOrg: vi.fn().mockResolvedValue({
            data: [
              {
                name: 'admin-dashboard',
                owner: { login: 'my-org' },
                default_branch: 'main',
                topics: ['sentinel-consumer'],
              },
              {
                name: 'internal-docs',
                owner: { login: 'my-org' },
                default_branch: 'main',
                topics: ['documentation'],
              }
            ]
          })
        }
      }
    };

    const repos = await discoverConsumerRepos(mockOctokit, 'my-org', 'sentinel-consumer');

    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe('admin-dashboard');
  });

  it('should fetch consumer source file tree and filter out ignored files', async () => {
    const mockOctokit = {
      rest: {
        git: {
          getTree: vi.fn().mockResolvedValue({
            data: {
              tree: [
                { path: 'src/pages/index.tsx', type: 'blob' },
                { path: 'src/__tests__/app.test.ts', type: 'blob' },
                { path: 'src/components/Header.tsx', type: 'blob' },
                { path: 'README.md', type: 'blob' },
              ]
            }
          })
        },
        repos: {
          getContent: vi.fn().mockImplementation(({ path }) => {
            if (path === 'src/pages/index.tsx') {
              return Promise.resolve({
                data: { content: Buffer.from('const page = "home";').toString('base64') }
              });
            }
            if (path === 'src/components/Header.tsx') {
              return Promise.resolve({
                data: { content: Buffer.from('export function Header() {}').toString('base64') }
              });
            }
            return Promise.reject(new Error('Not found'));
          })
        }
      }
    };

    const ignorePaths = ['**/__tests__/**'];
    const files = await fetchConsumerSourceTree(mockOctokit, 'my-org', 'web-frontend', 'main', ignorePaths);

    // Should fetch index.tsx and Header.tsx, but ignore app.test.ts and README.md
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('src/pages/index.tsx');
    expect(files[0].repositoryName).toBe('web-frontend');
    expect(files[1].path).toBe('src/components/Header.tsx');
  });
});

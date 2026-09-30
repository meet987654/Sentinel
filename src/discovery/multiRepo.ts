import { shouldIgnoreFile } from '../config.js';

export interface ConsumerRepoRef {
  owner: string;
  name: string;
  defaultBranch: string;
  topics: string[];
}

export interface ConsumerSourceFile {
  path: string;
  content: string;
  repositoryName: string;
}

/**
 * Discovers organization repositories tagged with a specific topic (e.g., 'sentinel-consumer').
 */
export async function discoverConsumerRepos(
  octokit: any,
  org: string,
  targetTopic: string = 'sentinel-consumer'
): Promise<ConsumerRepoRef[]> {
  const discovered: ConsumerRepoRef[] = [];

  if (!octokit || !org) {
    return discovered;
  }

  try {
    // 1. Search organization repos by topic query
    const searchQuery = `org:${org} topic:${targetTopic}`;
    const searchResponse = await octokit.rest.search.repos({
      q: searchQuery,
      per_page: 100,
    });

    if (searchResponse.data && Array.isArray(searchResponse.data.items)) {
      for (const item of searchResponse.data.items) {
        discovered.push({
          owner: item.owner?.login || org,
          name: item.name,
          defaultBranch: item.default_branch || 'main',
          topics: item.topics || [],
        });
      }
    }
  } catch (err: any) {
    // Fallback: List organization repos if topic search fails or is unsupported
    try {
      const listResponse = await octokit.rest.repos.listForOrg({
        org,
        per_page: 100,
      });

      if (listResponse.data && Array.isArray(listResponse.data)) {
        for (const item of listResponse.data) {
          const topics = item.topics || [];
          if (topics.includes(targetTopic)) {
            discovered.push({
              owner: item.owner?.login || org,
              name: item.name,
              defaultBranch: item.default_branch || 'main',
              topics,
            });
          }
        }
      }
    } catch {
      // Return empty array gracefully on network/permission error
    }
  }

  return discovered;
}

/**
 * Fetches TypeScript source file tree for a discovered consumer repository.
 */
export async function fetchConsumerSourceTree(
  octokit: any,
  owner: string,
  repo: string,
  ref: string = 'main',
  ignorePaths: string[] = []
): Promise<ConsumerSourceFile[]> {
  const files: ConsumerSourceFile[] = [];

  if (!octokit || !owner || !repo) {
    return files;
  }

  try {
    const treeResponse = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: 'true',
    });

    if (!treeResponse.data || !Array.isArray(treeResponse.data.tree)) {
      return files;
    }

    const candidateNodes = treeResponse.data.tree.filter((node: any) => {
      if (!node.path || node.type !== 'blob') return false;
      const isTsFile = node.path.endsWith('.ts') || node.path.endsWith('.tsx');
      if (!isTsFile) return false;
      return !shouldIgnoreFile(node.path, ignorePaths);
    });

    await Promise.all(
      candidateNodes.map(async (node: any) => {
        try {
          const contentResponse = await octokit.rest.repos.getContent({
            owner,
            repo,
            path: node.path,
            ref,
          });

          if (contentResponse.data && 'content' in contentResponse.data) {
            const rawContent = Buffer.from((contentResponse.data as any).content, 'base64').toString('utf8');
            files.push({
              path: node.path,
              content: rawContent,
              repositoryName: repo,
            });
          }
        } catch {
          // Ignore individual unreadable file
        }
      })
    );
  } catch {
    // Return empty list gracefully if tree fails
  }

  return files;
}

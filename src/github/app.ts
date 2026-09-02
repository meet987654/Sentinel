import { App } from 'octokit';
import { parseOpenApi } from '../schema/parser.js';
import { diffSchemas } from '../schema/differ.js';
import { analyzeConsumersFromProject } from '../analyzer/tsMorph.js';
import { generateSummary } from '../llm/summarizer.js';
import { createCheckRun, createOrUpdateComment } from './reporter.js';
import { ChangeReport, ConsumerFinding } from '../types.js';
import { Project } from 'ts-morph';

const APP_ID = process.env.APP_ID || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : '';
const SCHEMA_FILE_PATH = process.env.SCHEMA_FILE_PATH || 'openapi.yaml';

const app = new App({
  appId: APP_ID,
  privateKey: PRIVATE_KEY,
});

export async function handlePullRequestEvent(payload: any) {
  const installationId = payload.installation.id;
  const owner = payload.repository.owner.login;
  const repo = payload.repository.name;
  const prNumber = payload.pull_request.number;
  const baseRef = payload.pull_request.base.sha;
  const headRef = payload.pull_request.head.sha;

  console.log(`Processing PR #${prNumber} on ${owner}/${repo}`);
  const octokit = await app.getInstallationOctokit(installationId);

  // 1. Check if the schema file changed in this PR
  const files = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  const schemaFileChanged = files.data.some((f: any) => f.filename === SCHEMA_FILE_PATH);
  if (!schemaFileChanged) {
    console.log(`Schema file (${SCHEMA_FILE_PATH}) did not change. Exiting early.`);
    return;
  }

  // 2. Fetch Base and PR versions of the schema
  const baseContent = await getFileContent(octokit, owner, repo, SCHEMA_FILE_PATH, baseRef);
  const prContent = await getFileContent(octokit, owner, repo, SCHEMA_FILE_PATH, headRef);

  if (!baseContent || !prContent) {
    console.log('Could not fetch schema content for base or PR branch.');
    return;
  }

  // 3. Parse and Diff
  const baseSchema = await parseOpenApi(baseContent);
  const prSchema = await parseOpenApi(prContent);
  const changes = diffSchemas(baseSchema, prSchema);

  let findings: ConsumerFinding[] = [];
  let summary = '';

  if (changes.length > 0) {
    // 4. Fetch PR source files in-memory to run ts-morph
    const tsMorphProject = new Project({ useInMemoryFileSystem: true });
    
    // Get full tree for head commit
    const { data: treeData } = await octokit.rest.git.getTree({
      owner,
      repo,
      tree_sha: headRef,
      recursive: "true"
    });

    const tsFiles = treeData.tree.filter((t: any) => t.path && (t.path.endsWith('.ts') || t.path.endsWith('.tsx')));
    
    console.log(`Fetching ${tsFiles.length} TS files from GitHub for analysis...`);
    // Fetch concurrently in batches if needed, but for MVP Promise.all is fine
    await Promise.all(tsFiles.map(async (fileNode: any) => {
      const content = await getFileContent(octokit, owner, repo, fileNode.path, headRef);
      if (content) {
        tsMorphProject.createSourceFile(fileNode.path, content);
      }
    }));

    findings = analyzeConsumersFromProject(tsMorphProject, changes);

    // 5. Generate LLM Summary
    summary = await generateSummary(changes, findings);
  }

  const report: ChangeReport = {
    changes,
    findings,
    summary,
  };

  // 6. Post Comment and Check Run
  await createOrUpdateComment(octokit, owner, repo, prNumber, report);
  await createCheckRun(octokit, owner, repo, headRef, report);
  console.log(`Finished processing PR #${prNumber}`);
}

export async function getFileContent(octokit: any, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    
    if (response.data && 'content' in response.data) {
      return Buffer.from((response.data as any).content, 'base64').toString('utf8');
    }
    return null;
  } catch (error: any) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

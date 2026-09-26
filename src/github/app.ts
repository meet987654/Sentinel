import { App } from 'octokit';
import { parseOpenApi } from '../schema/parser.js';
import { diffSchemas } from '../schema/differ.js';
import { analyzeConsumersFromProject } from '../analyzer/tsMorph.js';
import { generateSummary } from '../llm/summarizer.js';
import { createCheckRun, createOrUpdateComment } from './reporter.js';
import { parseConfig, SentinelConfig } from '../config.js';
import { ChangeReport, ConsumerFinding } from '../types.js';
import { Project } from 'ts-morph';
import yaml from 'js-yaml';

const APP_ID = process.env.APP_ID || '';
const PRIVATE_KEY = process.env.PRIVATE_KEY ? process.env.PRIVATE_KEY.replace(/\\n/g, '\n') : '';
const SCHEMA_FILE_PATH = process.env.SCHEMA_FILE_PATH || 'openapi.yaml';

if (!APP_ID || isNaN(Number(APP_ID))) {
  console.warn('⚠️ WARNING: APP_ID is missing or not a number in .env. Using a dummy value (1) so the server can start, but API calls will fail.');
}

const app = new App({
  appId: !APP_ID || isNaN(Number(APP_ID)) ? 1 : Number(APP_ID),
  privateKey: PRIVATE_KEY || 'dummy_key',
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

  // 1. Check for per-repo configuration (.sentinel.yml)
  let sentinelConfig: SentinelConfig = parseConfig();
  try {
    const configContent = await getFileContent(octokit, owner, repo, '.sentinel.yml', headRef);
    if (configContent) {
      sentinelConfig = parseConfig(configContent);
      console.log(`Loaded custom config from .sentinel.yml: schemaPath=${sentinelConfig.schemaPath}, ignorePaths=${sentinelConfig.ignorePaths.length}`);
    }
  } catch (error) {
    console.log('Failed to fetch or parse .sentinel.yml, using default configuration.');
  }

  let schemaFilePath = sentinelConfig.schemaPath || SCHEMA_FILE_PATH;

  // 2. Check if the schema file changed in this PR
  const files = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
  });

  let schemaFileChanged = files.data.some((f: any) => f.filename === schemaFilePath);
  if (!schemaFileChanged && schemaFilePath === 'openapi.yaml') {
    const alternativeSchema = files.data.find((f: any) => f.filename === 'openapi.json' || f.filename === 'openapi.yml');
    if (alternativeSchema) {
      schemaFilePath = alternativeSchema.filename;
      schemaFileChanged = true;
      console.log(`Auto-detected schema file from PR: ${schemaFilePath}`);
    }
  }

  if (!schemaFileChanged) {
    console.log(`Schema file (${schemaFilePath}) did not change. Exiting early.`);
    await octokit.rest.checks.create({
      owner,
      repo,
      name: 'Sentinel API Check',
      head_sha: headRef,
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'No Schema Changes',
        summary: 'No changes were detected in the OpenAPI schema.'
      }
    });
    return;
  }

  // 3. Fetch Base and PR versions of the schema
  const baseContent = await getFileContent(octokit, owner, repo, schemaFilePath, baseRef);
  const prContent = await getFileContent(octokit, owner, repo, schemaFilePath, headRef);

  if (!baseContent || !prContent) {
    console.log('Could not fetch schema content for base or PR branch.');
    await octokit.rest.checks.create({
      owner,
      repo,
      name: 'Sentinel API Check',
      head_sha: headRef,
      status: 'completed',
      conclusion: 'success',
      output: {
        title: 'Schema Content Unavailable',
        summary: 'Could not fetch schema content for base or PR branch. Skipping check.'
      }
    });
    return;
  }

  // 3. Parse and Diff
  const baseResolver = {
    order: 1,
    canRead: /^github:\/\//i,
    read: async (file: any) => {
      const path = file.url.replace(/^github:\/\/internal\//i, '');
      const content = await getFileContent(octokit, owner, repo, path, baseRef);
      if (content === null) throw new Error(`File not found: ${path} at ${baseRef}`);
      return content;
    }
  };

  const headResolver = {
    order: 1,
    canRead: /^github:\/\//i,
    read: async (file: any) => {
      const path = file.url.replace(/^github:\/\/internal\//i, '');
      const content = await getFileContent(octokit, owner, repo, path, headRef);
      if (content === null) throw new Error(`File not found: ${path} at ${headRef}`);
      return content;
    }
  };

  const baseSchema = await parseOpenApi(baseContent, schemaFilePath, baseResolver);
  const prSchema = await parseOpenApi(prContent, schemaFilePath, headResolver);
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

    findings = analyzeConsumersFromProject(tsMorphProject, changes, sentinelConfig.ignorePaths);

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
  await createCheckRun(octokit, owner, repo, headRef, report, schemaFilePath, prContent);
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

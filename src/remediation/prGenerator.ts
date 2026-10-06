import { Project, SyntaxKind } from 'ts-morph';

export interface PropertyRenameRule {
  targetProperty: string;
  replacementProperty: string;
  targetSchema?: string;
}

export interface TransformedFile {
  filePath: string;
  originalContent: string;
  transformedContent: string;
  replacementsCount: number;
}

export interface RemediationPROptions {
  octokit?: any;
  repoOwner: string;
  repoName: string;
  baseBranch?: string;
  branchName?: string;
  providerPrNumber?: number;
  providerPrUrl?: string;
  isDraft?: boolean;
  dryRun?: boolean;
}

export interface RemediationPRResult {
  success: boolean;
  branchName: string;
  prNumber?: number;
  prUrl?: string;
  transformedFiles: TransformedFile[];
  totalReplacements: number;
  isDraft: boolean;
  isDryRun: boolean;
  error?: string;
}

/**
 * Applies AST property rename transformations using ts-morph.
 * Updates PropertyAccessExpressions and BindingElements referencing oldProperty.
 */
export function applyPropertyRename(
  sourceCode: string,
  oldProperty: string,
  newProperty: string,
  filePath = 'temp.ts'
): { updatedCode: string; replacementCount: number } {
  if (!sourceCode || !oldProperty || !newProperty || oldProperty === newProperty) {
    return { updatedCode: sourceCode, replacementCount: 0 };
  }

  let replacementCount = 0;
  const project = new Project({ useInMemoryFileSystem: true });

  try {
    const sourceFile = project.createSourceFile(filePath, sourceCode);

    // 1. Rename PropertyAccessExpressions: e.g. user.university -> user.college
    const propertyAccesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
    for (const pa of propertyAccesses) {
      const nameNode = pa.getNameNode();
      if (nameNode.getText() === oldProperty) {
        nameNode.replaceWithText(newProperty);
        replacementCount++;
      }
    }

    // 2. Rename BindingElements: e.g. const { university } = user -> const { college } = user
    const bindingElements = sourceFile.getDescendantsOfKind(SyntaxKind.BindingElement);
    for (const be of bindingElements) {
      const propNode = be.getPropertyNameNode();
      if (propNode && propNode.getText() === oldProperty) {
        propNode.replaceWithText(newProperty);
        replacementCount++;
      } else if (!propNode && be.getName() === oldProperty) {
        // Shorthand destructuring: { university } -> { college }
        be.replaceWithText(newProperty);
        replacementCount++;
      }
    }

    const updatedCode = sourceFile.getFullText();
    return { updatedCode, replacementCount };
  } catch {
    // Fallback regex replacement if AST parsing encounters partial syntax
    const regex = new RegExp(`\\b${oldProperty}\\b`, 'g');
    const matches = sourceCode.match(regex);
    const count = matches ? matches.length : 0;
    const updatedCode = sourceCode.replace(regex, newProperty);
    return { updatedCode, replacementCount: count };
  }
}

/**
 * Transforms an array of source files according to property rename rules.
 */
export function transformConsumerFiles(
  files: { filePath: string; content: string }[],
  rules: PropertyRenameRule[]
): TransformedFile[] {
  const transformed: TransformedFile[] = [];

  for (const file of files) {
    let currentContent = file.content;
    let fileReplacements = 0;

    for (const rule of rules) {
      const { updatedCode, replacementCount } = applyPropertyRename(
        currentContent,
        rule.targetProperty,
        rule.replacementProperty,
        file.filePath
      );
      currentContent = updatedCode;
      fileReplacements += replacementCount;
    }

    if (fileReplacements > 0) {
      transformed.push({
        filePath: file.filePath,
        originalContent: file.content,
        transformedContent: currentContent,
        replacementsCount: fileReplacements,
      });
    }
  }

  return transformed;
}

/**
 * Builds the Pull Request body description for an automated remediation PR.
 */
function buildRemediationPRBody(
  transformedFiles: TransformedFile[],
  rules: PropertyRenameRule[],
  options: RemediationPROptions
): string {
  const rulesSummary = rules
    .map(r => `- Renamed \`${r.targetProperty}\` &rarr; \`${r.replacementProperty}\``)
    .join('\n');

  const filesSummary = transformedFiles
    .map(f => `- \`${f.filePath}\` (${f.replacementsCount} replacement(s))`)
    .join('\n');

  const providerRef = options.providerPrUrl
    ? `Referenced Provider PR: [View upstream API change](${options.providerPrUrl})`
    : options.providerPrNumber
    ? `Referenced Provider PR: #${options.providerPrNumber}`
    : 'Triggered by upstream API contract change.';

  return `## 🛡️ Sentinel Automated Remediation Pull Request

This automated Draft Pull Request updates downstream consumer usages to adapt to breaking contract changes.

### 📋 Applied Contract Migrations
${rulesSummary}

### 📂 Modified Source Files (${transformedFiles.length})
${filesSummary}

---
${providerRef}

> *Generated automatically by Sentinel Contract Protection Agent.*`;
}

/**
 * Automated Remediation Pull Request Generator.
 * Transforms consumer codebases to resolve breaking changes and opens a Draft Pull Request on GitHub.
 */
export async function createRemediationPR(
  files: { filePath: string; content: string }[],
  rules: PropertyRenameRule[],
  options: RemediationPROptions
): Promise<RemediationPRResult> {
  const isDryRun = options.dryRun ?? false;
  const isDraft = options.isDraft ?? true;
  const primaryRule = rules[0] || { targetProperty: 'field', replacementProperty: 'newField' };
  const branchName =
    options.branchName ||
    `sentinel/fix-${primaryRule.targetProperty}-to-${primaryRule.replacementProperty}`;
  const baseBranch = options.baseBranch || 'main';

  // 1. Transform files using AST renamer
  const transformedFiles = transformConsumerFiles(files, rules);
  const totalReplacements = transformedFiles.reduce((acc, f) => acc + f.replacementsCount, 0);

  if (transformedFiles.length === 0) {
    return {
      success: true,
      branchName,
      transformedFiles: [],
      totalReplacements: 0,
      isDraft,
      isDryRun,
    };
  }

  // 2. If dryRun or no Octokit provided, return simulated result
  if (isDryRun || !options.octokit) {
    return {
      success: true,
      branchName,
      transformedFiles,
      totalReplacements,
      isDraft,
      isDryRun: true,
      prNumber: 999,
      prUrl: `https://github.com/${options.repoOwner}/${options.repoName}/pull/999`,
    };
  }

  // 3. Live GitHub execution via Octokit
  try {
    const { octokit, repoOwner, repoName } = options;

    // Get default branch commit SHA
    const baseRef = await octokit.rest.git.getRef({
      owner: repoOwner,
      repo: repoName,
      ref: `heads/${baseBranch}`,
    });
    const latestCommitSha = baseRef.data.object.sha;

    // Create fix branch
    await octokit.rest.git.createRef({
      owner: repoOwner,
      repo: repoName,
      ref: `refs/heads/${branchName}`,
      sha: latestCommitSha,
    });

    // Commit modified files to branch
    for (const tf of transformedFiles) {
      let fileSha: string | undefined;
      try {
        const existing = await octokit.rest.repos.getContent({
          owner: repoOwner,
          repo: repoName,
          path: tf.filePath,
          ref: branchName,
        });
        if (!Array.isArray(existing.data) && 'sha' in existing.data) {
          fileSha = existing.data.sha;
        }
      } catch {
        fileSha = undefined;
      }

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: repoOwner,
        repo: repoName,
        path: tf.filePath,
        message: `refactor(sentinel): update ${primaryRule.targetProperty} to ${primaryRule.replacementProperty}`,
        content: Buffer.from(tf.transformedContent, 'utf-8').toString('base64'),
        branch: branchName,
        sha: fileSha,
      });
    }

    // Open Draft PR
    const prTitle = `refactor(sentinel): migrate ${primaryRule.targetProperty} to ${primaryRule.replacementProperty}`;
    const prBody = buildRemediationPRBody(transformedFiles, rules, options);

    const prResponse = await octokit.rest.pulls.create({
      owner: repoOwner,
      repo: repoName,
      title: prTitle,
      body: prBody,
      head: branchName,
      base: baseBranch,
      draft: isDraft,
    });

    return {
      success: true,
      branchName,
      prNumber: prResponse.data.number,
      prUrl: prResponse.data.html_url,
      transformedFiles,
      totalReplacements,
      isDraft,
      isDryRun: false,
    };
  } catch (err: any) {
    return {
      success: false,
      branchName,
      transformedFiles,
      totalReplacements,
      isDraft,
      isDryRun: false,
      error: `Failed to create remediation PR: ${err.message}`,
    };
  }
}

import { BreakingChange, ChangeReport, ConsumerFinding } from '../types.js';

export async function createOrUpdateComment(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number,
  report: ChangeReport
) {
  const commentBody = formatComment(report);

  // Find existing comment
  const comments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existingComment = comments.data.find((c: any) =>
    c.body?.includes('## 🛡️ Sentinel — API Contract Check')
  );

  if (existingComment) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: commentBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    });
  }
}

export async function createCheckRun(
  octokit: any,
  owner: string,
  repo: string,
  headSha: string,
  report: ChangeReport,
  schemaFilePath: string = 'openapi.yaml',
  prContent: string = ''
) {
  const breakingCount = report.changes.filter(c => c.severity === 'breaking').length;
  
  const annotations: any[] = [];
  for (const change of report.changes) {
    const line = findLineNumber(prContent, change.path, change.type);
    annotations.push({
      path: schemaFilePath,
      start_line: line,
      end_line: line,
      annotation_level: change.severity === 'breaking' ? 'failure' : 'warning',
      message: `${change.severity.toUpperCase()} CHANGE: ${change.type} - ${change.path.split('.').pop()}`
    });
  }

  // GitHub allows max 50 annotations per request.
  const batch = annotations.slice(0, 50);

  await octokit.rest.checks.create({
    owner,
    repo,
    name: 'Sentinel API Check',
    head_sha: headSha,
    status: 'completed',
    conclusion: breakingCount > 0 ? 'failure' : 'success',
    output: {
      title: breakingCount > 0 ? `${breakingCount} breaking changes found` : 'API Contract is safe',
      summary: report.summary || 'Completed schema diff analysis.',
      annotations: batch.length > 0 ? batch : undefined
    }
  });
}

function findLineNumber(content: string, path: string, changeType: string): number {
  if (!content) return 1;
  const lines = content.split('\n');
  const parts = path.split('.');
  const endpoint = parts[0]; // e.g. "GET /users/{id}"
  const method = endpoint.split(' ')[0]?.toLowerCase();
  const route = endpoint.split(' ')[1];

  let routeLine = -1;
  let methodLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (route && (line.includes(`'${route}'`) || line.includes(`"${route}"`) || line.includes(`${route}:`))) {
      routeLine = i + 1;
    } else if (routeLine !== -1 && method && line.trim().startsWith(`${method}:`)) {
      methodLine = i + 1;
      break;
    }
  }

  const startSearchLine = methodLine !== -1 ? methodLine : (routeLine !== -1 ? routeLine : 1);

  if (changeType === 'FIELD_REMOVED' || changeType === 'ENDPOINT_REMOVED') {
    // Cannot find the specific field since it was removed in the PR branch, fallback to the method or route line
    return startSearchLine;
  }

  // For other changes, search for the specific property name
  const targetProp = parts[parts.length - 1];
  for (let i = startSearchLine - 1; i < lines.length; i++) {
    if (lines[i].includes(`${targetProp}:`)) {
      return i + 1;
    }
  }

  return startSearchLine;
}

function formatComment(report: ChangeReport): string {
  const breakingCount = report.changes.filter(c => c.severity === 'breaking').length;
  const warningCount = report.changes.filter(c => c.severity === 'warning').length;

  let markdown = `## 🛡️ Sentinel — API Contract Check\n\n`;

  if (breakingCount === 0) {
    markdown += `✅ **No breaking changes detected.**\n`;
    if (warningCount > 0) {
      markdown += `\n### ⚠️ Warnings (${warningCount})\n`;
      report.changes.filter(c => c.severity === 'warning').forEach(c => {
        markdown += `- \`${c.path}\`: ${c.type}\n`;
      });
    }
    return markdown;
  }

  markdown += `### ⚠️ Breaking Changes (${breakingCount})\n\n`;

  // Group by endpoint roughly based on path
  // Our paths look like: "GET /users/{id}.response.200.email"
  const grouped = new Map<string, BreakingChange[]>();
  for (const change of report.changes.filter(c => c.severity === 'breaking')) {
    const parts = change.path.split('.');
    const endpoint = parts[0];
    if (!grouped.has(endpoint)) grouped.set(endpoint, []);
    grouped.get(endpoint)!.push(change);
  }

  for (const [endpoint, changes] of grouped.entries()) {
    markdown += `**${endpoint}**\n`;
    for (const c of changes) {
      const remainingPath = c.path.substring(endpoint.length + 1);
      markdown += `- \`${remainingPath}\`: ${c.type}`;
      if (c.oldValue || c.newValue) {
        markdown += ` (\`${c.oldValue}\` → \`${c.newValue}\`)`;
      }
      markdown += `\n`;
    }
    markdown += `\n`;
  }

  markdown += `### 🔍 Likely Affected Code\n\n`;
  if (report.findings.length === 0) {
    markdown += `*No medium-confidence usages found in this repository.*\n\n`;
  } else {
    markdown += `**MEDIUM confidence**\n`;
    for (const f of report.findings) {
      markdown += `- \`${f.filePath}:${f.lineNumber}\` — \`${f.snippet}\`\n`;
    }
    markdown += `\n`;
  }

  if (report.summary) {
    markdown += `### 💡 Summary\n${report.summary}\n\n`;
  }

  markdown += `Merge status: **BLOCKED** (${breakingCount} breaking changes found)\n`;

  return markdown;
}

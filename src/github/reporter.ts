import { BreakingChange, ChangeReport, ConsumerFinding } from '../types.js';

export const SENTINEL_SIGNATURE_TAG = '<!-- sentinel-impact-report -->';

export async function createOrUpdateComment(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number,
  report: ChangeReport
) {
  const timestamp = new Date().toISOString();
  const commentBody = formatComment(report, timestamp);

  // Find existing comment using signature tag or header
  const comments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  const existingComment = comments.data.find((c: any) =>
    c.body?.includes(SENTINEL_SIGNATURE_TAG) || c.body?.includes('## 🛡️ Sentinel — API Contract Check')
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

  // 1. Spec file annotations
  for (const change of report.changes) {
    const line = findLineNumber(prContent, change.path, change.type);
    annotations.push({
      path: schemaFilePath,
      start_line: line,
      end_line: line,
      annotation_level: change.severity === 'breaking' ? 'failure' : 'warning',
      message: `${change.severity.toUpperCase()} CHANGE: ${change.type} - ${change.path.split('.').pop()}`,
      title: `Sentinel: ${change.type}`,
    });
  }

  // 2. Consumer file annotations
  for (const finding of report.findings) {
    annotations.push({
      path: finding.filePath,
      start_line: finding.lineNumber,
      end_line: finding.lineNumber,
      annotation_level: 'warning',
      message: `[${finding.confidence.toUpperCase()}] Property '${finding.property}' accesses a modified or removed API property in ${schemaFilePath}.`,
      title: `Sentinel Consumer Impact (${finding.confidence.toUpperCase()})`,
    });
  }

  // GitHub allows max 50 annotations per request.
  const batch = annotations.slice(0, 50);
  const summaryText = formatCheckRunSummary(report, schemaFilePath);

  await octokit.rest.checks.create({
    owner,
    repo,
    name: 'Sentinel API Check',
    head_sha: headSha,
    status: 'completed',
    conclusion: breakingCount > 0 ? 'failure' : 'success',
    output: {
      title: breakingCount > 0 ? `🚨 ${breakingCount} Breaking API Contract Change(s)` : '✅ API Contract Safe (0 Breaking Changes)',
      summary: summaryText,
      annotations: batch.length > 0 ? batch : undefined
    }
  });
}

export function formatCheckRunSummary(report: ChangeReport, schemaFilePath: string = 'openapi.yaml'): string {
  const breakingCount = report.changes.filter(c => c.severity === 'breaking').length;
  const warningCount = report.changes.filter(c => c.severity === 'warning').length;
  const confirmedFindings = report.findings.filter(f => f.confidence === 'confirmed').length;

  let summary = `## 🛡️ Sentinel API Impact Check Summary\n\n`;

  summary += `| Metric | Value | Status |\n`;
  summary += `| :--- | :--- | :--- |\n`;
  summary += `| ⚠️ **Breaking Schema Changes** | \`${breakingCount}\` | ${breakingCount > 0 ? '❌ Failure' : '✅ Safe'} |\n`;
  summary += `| 🔍 **Warning Changes** | \`${warningCount}\` | ${warningCount > 0 ? '⚠️ Warning' : '✅ Clean'} |\n`;
  summary += `| 🎯 **Confirmed Consumer Usages** | \`${confirmedFindings}\` | ${confirmedFindings > 0 ? '🚨 High Impact' : '✅ None'} |\n`;
  summary += `| 📄 **Schema File** | \`${schemaFilePath}\` | 📌 Primary Contract |\n\n`;

  if (report.changes.length > 0) {
    summary += `### 📊 Contract Changes Breakdown\n`;
    for (const change of report.changes) {
      summary += `- **${change.severity.toUpperCase()}**: \`${change.path}\` (${change.type})\n`;
    }
    summary += `\n`;
  }

  if (report.findings.length > 0) {
    summary += `### 🔍 Consumer Line Annotations (${report.findings.length})\n`;
    for (const f of report.findings) {
      summary += `- \`${f.filePath}:${f.lineNumber}\` [${f.confidence.toUpperCase()}]: \`${f.snippet}\`\n`;
    }
    summary += `\n`;
  }

  if (report.summary) {
    summary += `### 💡 Evidence Summary\n${report.summary}\n`;
  }

  return summary;
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

export function formatComment(report: ChangeReport, timestamp?: string): string {
  const breakingCount = report.changes.filter(c => c.severity === 'breaking').length;
  const warningCount = report.changes.filter(c => c.severity === 'warning').length;

  let markdown = `${SENTINEL_SIGNATURE_TAG}\n## 🛡️ Sentinel — API Contract Check\n\n`;

  if (breakingCount === 0) {
    markdown += `✅ **No breaking changes detected.**\n`;
    if (warningCount > 0) {
      markdown += `\n### ⚠️ Warnings (${warningCount})\n`;
      report.changes.filter(c => c.severity === 'warning').forEach(c => {
        markdown += `- \`${c.path}\`: ${c.type}\n`;
      });
    }
    if (timestamp) {
      markdown += `\n---\n*Last updated by Sentinel at: \`${timestamp}\`*\n`;
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
    markdown += `*No consumer usages found in this repository.*\n\n`;
  } else {
    const confirmed = report.findings.filter(f => f.confidence === 'confirmed');
    const high = report.findings.filter(f => f.confidence === 'high');
    const medium = report.findings.filter(f => f.confidence === 'medium');

    if (confirmed.length > 0) {
      markdown += `**CONFIRMED Source Usages (Statically Resolved)**\n`;
      for (const f of confirmed) {
        markdown += `- \`${f.filePath}:${f.lineNumber}\` — \`${f.snippet}\`\n`;
      }
      markdown += `\n`;
    }

    if (high.length > 0) {
      markdown += `**HIGH Confidence**\n`;
      for (const f of high) {
        markdown += `- \`${f.filePath}:${f.lineNumber}\` — \`${f.snippet}\`\n`;
      }
      markdown += `\n`;
    }

    if (medium.length > 0) {
      markdown += `**MEDIUM Confidence (Name Matched)**\n`;
      for (const f of medium) {
        markdown += `- \`${f.filePath}:${f.lineNumber}\` — \`${f.snippet}\`\n`;
      }
      markdown += `\n`;
    }
  }

  if (report.summary) {
    markdown += `### 💡 Summary\n${report.summary}\n\n`;
  }

  markdown += `Merge status: **BLOCKED** (${breakingCount} breaking changes found)\n`;

  if (timestamp) {
    markdown += `\n---\n*Last updated by Sentinel at: \`${timestamp}\`*\n`;
  }

  return markdown;
}

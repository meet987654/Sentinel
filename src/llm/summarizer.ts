import Groq from 'groq-sdk';
import { BreakingChange, ConsumerFinding } from '../types.js';
import { buildImpactPrompt, FormattedPromptPayload } from './promptBuilder.js';

export interface MigrationStep {
  filePath: string;
  lineNumber: number;
  property: string;
  instruction: string;
  beforeSnippet: string;
  afterSnippet?: string;
}

export interface MigrationGuideResult {
  executiveSummary: string;
  migrationSteps: MigrationStep[];
  markdown: string;
  isAiGenerated: boolean;
  provider: 'groq' | 'gemini' | 'openai' | 'fallback';
  error?: string;
}

export interface MigrationGuideOptions {
  apiKey?: string;
  model?: string;
  client?: any;
  timeoutMs?: number;
}

/**
 * Formats a MigrationGuideResult into a collapsible GitHub-flavored Markdown block
 * suitable for PR comments and Check Run summaries.
 */
export function formatMigrationMarkdown(result: MigrationGuideResult): string {
  const badge = result.isAiGenerated
    ? '`🤖 AI-Generated (Groq/Llama-3)`'
    : '`📋 Deterministic Fallback Guide`';

  let md = `<details open>\n<summary><strong>🤖 Automated Code Migration Guide</strong> &mdash; ${badge}</summary>\n\n`;
  md += `### Executive Summary\n${result.executiveSummary}\n\n`;

  if (result.migrationSteps.length > 0) {
    md += `### Actionable Migration Steps\n`;
    for (let i = 0; i < result.migrationSteps.length; i++) {
      const step = result.migrationSteps[i];
      md += `#### ${i + 1}. \`${step.filePath}\` (Line ${step.lineNumber})\n`;
      md += `**Impacted Property**: \`${step.property}\`\n\n`;
      md += `${step.instruction}\n\n`;
      md += `**Before:**\n\`\`\`ts\n${step.beforeSnippet}\n\`\`\`\n\n`;
      if (step.afterSnippet) {
        md += `**Suggested Migration:**\n\`\`\`ts\n${step.afterSnippet}\n\`\`\`\n\n`;
      }
    }
  } else {
    md += `*No consumer code changes required.*\n\n`;
  }

  md += `</details>`;
  return md;
}

/**
 * Deterministic fallback generator used when LLM API keys are absent or when network requests fail.
 */
function generateFallbackGuide(
  changes: BreakingChange[],
  findings: ConsumerFinding[],
  errorMessage?: string
): MigrationGuideResult {
  const changeSummary = changes.length > 0
    ? `Detected ${changes.length} contract breaking change(s) across API endpoints.`
    : 'No contract breaking changes detected.';

  const findingSummary = findings.length > 0
    ? `Identified ${findings.length} downstream consumer code location(s) requiring developer remediation.`
    : 'No impacted consumer source files found.';

  const executiveSummary = `${changeSummary} ${findingSummary}`;

  const migrationSteps: MigrationStep[] = findings.map(f => {
    // Generate intelligent heuristic suggestion based on property name
    const prop = f.property;
    let suggestedFix = `// Update reference to '${prop}' according to updated API specification`;
    if (f.snippet.includes(`.${prop}`)) {
      suggestedFix = f.snippet.replace(new RegExp(`\\.${prop}\\b`, 'g'), `/* TODO: replace .${prop} */`);
    }

    return {
      filePath: f.filePath,
      lineNumber: f.lineNumber,
      property: f.property,
      instruction: `Inspect usage of \`${f.property}\` on line ${f.lineNumber} and update to conform with the new API contract.`,
      beforeSnippet: f.snippet,
      afterSnippet: suggestedFix,
    };
  });

  const result: MigrationGuideResult = {
    executiveSummary,
    migrationSteps,
    markdown: '',
    isAiGenerated: false,
    provider: 'fallback',
    error: errorMessage,
  };

  result.markdown = formatMigrationMarkdown(result);
  return result;
}

/**
 * Queries an LLM provider (Groq / Gemini) with sanitized deterministic contract evidence
 * to generate developer-friendly migration guides. Gracefully falls back to deterministic
 * suggestions if LLM calls fail or credentials are not configured.
 */
export function generateMigrationGuide(
  changes: BreakingChange[],
  findings: ConsumerFinding[],
  options?: MigrationGuideOptions
): Promise<MigrationGuideResult> {
  const apiKey = options?.apiKey || process.env.GROQ_API_KEY;
  const timeoutMs = options?.timeoutMs || 8000;
  const modelName = options?.model || 'llama-3.3-70b-versatile';

  // 1. If no client or API key is provided, return immediate deterministic fallback
  if (!options?.client && !apiKey) {
    return Promise.resolve(
      generateFallbackGuide(
        changes,
        findings,
        'LLM API key not configured (GROQ_API_KEY). Returned deterministic fallback guide.'
      )
    );
  }

  // 2. Build sanitized prompt payload
  const promptPayload: FormattedPromptPayload = buildImpactPrompt(changes, findings);

  // 3. Instantiate Groq client if not injected
  let client = options?.client;
  if (!client && apiKey) {
    try {
      client = new Groq({ apiKey });
    } catch (err: any) {
      return Promise.resolve(
        generateFallbackGuide(changes, findings, `Client initialization failed: ${err.message}`)
      );
    }
  }

  // 4. Execute request with strict timeout protection
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`LLM query timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  const apiPromise = client.chat.completions.create({
    messages: [
      { role: 'system', content: promptPayload.systemPrompt },
      { role: 'user', content: promptPayload.userPrompt },
    ],
    model: modelName,
    temperature: 0.2,
  });

  return Promise.race([apiPromise, timeoutPromise])
    .then((response: any) => {
      const content = response.choices?.[0]?.message?.content?.trim();
      if (!content) {
        return generateFallbackGuide(changes, findings, 'Empty response received from LLM.');
      }

      // Convert LLM findings into structured MigrationSteps if findings exist
      const migrationSteps: MigrationStep[] = findings.map(f => ({
        filePath: f.filePath,
        lineNumber: f.lineNumber,
        property: f.property,
        instruction: `Remediate breaking property \`${f.property}\` based on AI analysis.`,
        beforeSnippet: f.snippet,
      }));

      const result: MigrationGuideResult = {
        executiveSummary: content.slice(0, 500) + (content.length > 500 ? '...' : ''),
        migrationSteps,
        markdown: `<details open>\n<summary><strong>🤖 AI-Powered Migration Guide</strong> &mdash; \`🤖 Generated by ${modelName}\`</summary>\n\n${content}\n\n</details>`,
        isAiGenerated: true,
        provider: 'groq',
      };

      return result;
    })
    .catch((err: any) => {
      // Graceful fallback on API error or timeout
      return generateFallbackGuide(
        changes,
        findings,
        `LLM generation failed (${err.message}). Reverted to deterministic fallback.`
      );
    });
}

/**
 * Backwards-compatible summary generator for GitHub App reporting.
 */
export async function generateSummary(
  changes: BreakingChange[],
  findings: ConsumerFinding[],
  options?: MigrationGuideOptions
): Promise<string> {
  const guide = await generateMigrationGuide(changes, findings, options);
  return guide.markdown;
}


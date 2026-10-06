import { BreakingChange, ConsumerFinding } from '../types.js';

export interface PromptBuilderOptions {
  maxCharacterBudget?: number;
  targetLanguage?: 'typescript' | 'javascript' | 'python' | 'general';
  includeMetadataSummary?: boolean;
}

export interface SanitizationResult {
  sanitized: string;
  redactedCount: number;
}

export interface FormattedPromptPayload {
  systemPrompt: string;
  userPrompt: string;
  metadata: {
    totalChanges: number;
    totalFindings: number;
    redactedSecretsCount: number;
    estimatedTokens: number;
    isTruncated: boolean;
  };
}

/**
 * Scans a code snippet or string, redacting API keys, passwords, and secrets.
 */
export function sanitizeCodeSnippet(snippet: string): SanitizationResult {
  if (!snippet) return { sanitized: '', redactedCount: 0 };

  let sanitized = snippet;
  let redactedCount = 0;

  // 1. Bearer tokens & JWTs
  sanitized = sanitized.replace(
    /(bearer\s+)eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/gi,
    () => {
      redactedCount++;
      return 'Bearer [REDACTED_JWT]';
    }
  );

  // 2. GitHub Personal Access Tokens
  sanitized = sanitized.replace(
    /\b(ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82})\b/g,
    () => {
      redactedCount++;
      return '[REDACTED_SECRET]';
    }
  );

  // 3. Generic / Stripe / OpenAI / AWS secret keys
  sanitized = sanitized.replace(
    /\b(sk_live_[0-9a-zA-Z]{24,}|sk-[a-zA-Z0-9]{32,}|AKIA[0-9A-Z]{16})\b/g,
    () => {
      redactedCount++;
      return '[REDACTED_SECRET]';
    }
  );

  // 4. Key-value secret assignments: api_key = "...", token: '...', password: "..."
  sanitized = sanitized.replace(
    /((?:api_?key|secret|password|access_?token|auth_?token|private_?key)\s*[:=]\s*['"])([^'"]{6,})(['"])/gi,
    (_match, prefix, _secretVal, suffix) => {
      redactedCount++;
      return `${prefix}[REDACTED_SECRET]${suffix}`;
    }
  );

  // 5. Private key block headers
  sanitized = sanitized.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    () => {
      redactedCount++;
      return '[REDACTED_PRIVATE_KEY]';
    }
  );

  return { sanitized, redactedCount };
}

/**
 * Builds a deterministic evidence prompt payload for downstream LLMs (Gemini / OpenAI / Groq).
 * Combines contract breaking change diffs with exact AST code findings,
 * redacts secrets, and budgets tokens.
 */
export function buildImpactPrompt(
  changes: BreakingChange[],
  findings: ConsumerFinding[],
  options?: PromptBuilderOptions
): FormattedPromptPayload {
  const maxBudget = options?.maxCharacterBudget || 16000; // ~4000 tokens
  let totalRedacted = 0;

  const systemPrompt = `You are Sentinel AI, an expert API Contract Migration & Reliability Assistant.
Your core operating principle is: Deterministic AST analysis establishes undeniable evidence; AI explains the evidence and provides safe, actionable code migrations.

Given a list of breaking API/schema changes and the exact consumer source code locations where affected fields are used:
1. Provide a concise Executive Summary of the breakage.
2. Outline the Root Cause for each breaking change.
3. Deliver a Step-by-Step Developer Migration Guide with clear "Before" and "After" code diffs for each affected file.
4. Highlight any edge cases, backwards compatibility risks, or recommendations for phased rollout.

Maintain an objective, technical tone. Do not speculate beyond the provided deterministic findings.`;

  // 1. Format Breaking Changes section
  const changesLines: string[] = ['### Deterministic Contract Breaking Changes:'];
  if (changes.length === 0) {
    changesLines.push('- None detected.');
  } else {
    for (const c of changes) {
      const proto = c.protocol ? `[${c.protocol.toUpperCase()}] ` : '';
      let detail = `${proto}**${c.type}** at \`${c.path}\` (Severity: ${c.severity.toUpperCase()})`;
      if (c.oldValue !== undefined || c.newValue !== undefined) {
        detail += ` | Changed: \`${JSON.stringify(c.oldValue)}\` -> \`${JSON.stringify(c.newValue)}\``;
      }
      changesLines.push(`- ${detail}`);
    }
  }

  // 2. Format Consumer Findings section grouped by file
  const findingsLines: string[] = ['\n### Affected Consumer Source Code Usages:'];
  let isTruncated = false;

  if (findings.length === 0) {
    findingsLines.push('- No downstream consumer code usages were detected.');
  } else {
    // Group findings by filePath
    const grouped = new Map<string, ConsumerFinding[]>();
    for (const f of findings) {
      const list = grouped.get(f.filePath) || [];
      list.push(f);
      grouped.set(f.filePath, list);
    }

    let currentLength = changesLines.join('\n').length + systemPrompt.length;

    for (const [filePath, fileFindings] of grouped.entries()) {
      const fileHeader = `\nFile: \`${filePath}\``;
      findingsLines.push(fileHeader);
      currentLength += fileHeader.length;

      for (const f of fileFindings) {
        const { sanitized, redactedCount } = sanitizeCodeSnippet(f.snippet);
        totalRedacted += redactedCount;

        const lineEntry = `  - Line ${f.lineNumber} (Property: \`${f.property}\`, Confidence: ${f.confidence.toUpperCase()}):\n    \`\`\`${options?.targetLanguage || 'ts'}\n    ${sanitized}\n    \`\`\``;

        if (currentLength + lineEntry.length > maxBudget) {
          isTruncated = true;
          findingsLines.push('\n... [Additional findings omitted due to token context budget limit]');
          break;
        }

        findingsLines.push(lineEntry);
        currentLength += lineEntry.length;
      }

      if (isTruncated) break;
    }
  }

  const instructions = `\n\n### Migration Prompt Request:
Based strictly on the deterministic findings above, generate an actionable code migration guide showing developers how to adapt their consumer code to resolve these breaking changes safely.`;

  const userPrompt = `${changesLines.join('\n')}\n${findingsLines.join('\n')}${instructions}`;
  const totalChars = systemPrompt.length + userPrompt.length;
  const estimatedTokens = Math.ceil(totalChars / 4);

  return {
    systemPrompt,
    userPrompt,
    metadata: {
      totalChanges: changes.length,
      totalFindings: findings.length,
      redactedSecretsCount: totalRedacted,
      estimatedTokens,
      isTruncated,
    },
  };
}

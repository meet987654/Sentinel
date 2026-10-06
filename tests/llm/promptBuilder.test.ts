import { describe, it, expect } from 'vitest';
import {
  sanitizeCodeSnippet,
  buildImpactPrompt,
} from '../../src/llm/promptBuilder.js';
import { BreakingChange, ConsumerFinding } from '../../src/types.js';

describe('Deterministic Evidence Synthesizer & Code Sanitizer', () => {
  describe('sanitizeCodeSnippet', () => {
    it('redacts Bearer tokens and JWTs from code snippets', () => {
      const code = 'const headers = { Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.doNotLeakThisSignature" };';
      const result = sanitizeCodeSnippet(code);
      expect(result.redactedCount).toBeGreaterThanOrEqual(1);
      expect(result.sanitized).toContain('Bearer [REDACTED_JWT]');
      expect(result.sanitized).not.toContain('doNotLeakThisSignature');
    });

    it('redacts GitHub Personal Access Tokens and OpenAI/Stripe keys', () => {
      const mockStripe = ['sk_', 'live_', '1234567890abcdef12345678'].join('');
      const mockGh = ['ghp_', '1234567890abcdef1234567890abcdef1234'].join('');
      const code = `
        const ghToken = "${mockGh}";
        const stripeKey = "${mockStripe}";
      `;
      const result = sanitizeCodeSnippet(code);
      expect(result.redactedCount).toBe(2);
      expect(result.sanitized).toContain('[REDACTED_SECRET]');
      expect(result.sanitized).not.toContain(mockGh);
      expect(result.sanitized).not.toContain(mockStripe);
    });

    it('redacts key-value password and secret assignments', () => {
      const code = 'const config = { api_key: "super_secret_api_key_value", password: "db_master_password" };';
      const result = sanitizeCodeSnippet(code);
      expect(result.redactedCount).toBe(2);
      expect(result.sanitized).toContain('api_key: "[REDACTED_SECRET]"');
      expect(result.sanitized).toContain('password: "[REDACTED_SECRET]"');
    });

    it('preserves clean code without false positive redactions', () => {
      const code = 'const user = { name: "Alice", email: "alice@example.com", count: 42 };';
      const result = sanitizeCodeSnippet(code);
      expect(result.redactedCount).toBe(0);
      expect(result.sanitized).toBe(code);
    });

    it('handles empty input safely', () => {
      expect(sanitizeCodeSnippet('')).toEqual({ sanitized: '', redactedCount: 0 });
    });
  });

  describe('buildImpactPrompt', () => {
    const sampleChanges: BreakingChange[] = [
      {
        type: 'FIELD_REMOVED',
        severity: 'breaking',
        path: 'GET /users.response.200.university',
        oldValue: 'string',
        protocol: 'openapi',
      },
      {
        type: 'GRAPHQL_FIELD_REMOVED',
        severity: 'breaking',
        path: 'User.college',
        protocol: 'graphql',
      },
    ];

    const sampleFindings: ConsumerFinding[] = [
      {
        confidence: 'confirmed',
        filePath: 'src/components/UserCard.tsx',
        lineNumber: 14,
        snippet: 'return <div>{user.university}</div>;',
        property: 'university',
      },
      {
        confidence: 'high',
        filePath: 'src/components/UserCard.tsx',
        lineNumber: 22,
        snippet: 'const { college } = profile;',
        property: 'college',
      },
      {
        confidence: 'confirmed',
        filePath: 'src/services/api.ts',
        lineNumber: 8,
        snippet: `const token = "${['sk_', 'live_', 'secret1234567890abcdef1234'].join('')}"; return res.university;`,
        property: 'university',
      },
    ];

    it('synthesizes changes and findings into structured system and user prompts', () => {
      const payload = buildImpactPrompt(sampleChanges, sampleFindings);

      expect(payload.systemPrompt).toContain('Sentinel AI');
      expect(payload.systemPrompt).toContain('Deterministic AST analysis establishes undeniable evidence');

      expect(payload.userPrompt).toContain('### Deterministic Contract Breaking Changes:');
      expect(payload.userPrompt).toContain('[OPENAPI]');
      expect(payload.userPrompt).toContain('GET /users.response.200.university');
      expect(payload.userPrompt).toContain('[GRAPHQL]');
      expect(payload.userPrompt).toContain('User.college');

      expect(payload.userPrompt).toContain('### Affected Consumer Source Code Usages:');
      expect(payload.userPrompt).toContain('File: `src/components/UserCard.tsx`');
      expect(payload.userPrompt).toContain('File: `src/services/api.ts`');

      // Check metadata
      expect(payload.metadata.totalChanges).toBe(2);
      expect(payload.metadata.totalFindings).toBe(3);
      expect(payload.metadata.redactedSecretsCount).toBe(1); // from src/services/api.ts
      expect(payload.metadata.isTruncated).toBe(false);
      expect(payload.metadata.estimatedTokens).toBeGreaterThan(50);
    });

    it('respects character and token budget truncation', () => {
      const payload = buildImpactPrompt(sampleChanges, sampleFindings, {
        maxCharacterBudget: 250, // very tight budget to force truncation
      });

      expect(payload.metadata.isTruncated).toBe(true);
      expect(payload.userPrompt).toContain('Additional findings omitted due to token context budget limit');
    });

    it('handles empty changes and findings gracefully without crashing', () => {
      const payload = buildImpactPrompt([], []);

      expect(payload.metadata.totalChanges).toBe(0);
      expect(payload.metadata.totalFindings).toBe(0);
      expect(payload.metadata.isTruncated).toBe(false);
      expect(payload.userPrompt).toContain('None detected.');
      expect(payload.userPrompt).toContain('No downstream consumer code usages were detected.');
    });
  });
});

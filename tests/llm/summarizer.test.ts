import { describe, it, expect, vi } from 'vitest';
import {
  generateMigrationGuide,
  formatMigrationMarkdown,
  generateSummary,
  MigrationGuideResult,
} from '../../src/llm/summarizer.js';
import { BreakingChange, ConsumerFinding } from '../../src/types.js';

describe('LLM Migration Guide Generator & Fallback Engine', () => {
  const sampleChanges: BreakingChange[] = [
    {
      type: 'FIELD_REMOVED',
      severity: 'breaking',
      path: 'GET /users.response.200.university',
      oldValue: 'string',
    },
  ];

  const sampleFindings: ConsumerFinding[] = [
    {
      confidence: 'confirmed',
      filePath: 'src/components/UserProfile.tsx',
      lineNumber: 12,
      snippet: 'const uni = user.university;',
      property: 'university',
    },
  ];

  it('generates an AI-powered migration guide when a valid client responds', async () => {
    const mockAiResponse = `### Executive Summary
The 'university' field was dropped from GET /users.

### Migration Guide
Replace user.university with user.institution or user.college.`;

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [
              {
                message: {
                  content: mockAiResponse,
                },
              },
            ],
          }),
        },
      },
    };

    const result = await generateMigrationGuide(sampleChanges, sampleFindings, {
      client: mockClient,
      model: 'llama-3.3-70b-versatile',
    });

    expect(result.isAiGenerated).toBe(true);
    expect(result.provider).toBe('groq');
    expect(result.executiveSummary).toContain('university');
    expect(result.markdown).toContain('AI-Powered Migration Guide');
    expect(mockClient.chat.completions.create).toHaveBeenCalledOnce();
  });

  it('gracefully falls back to deterministic suggestions when no API key or client is configured', async () => {
    // Ensure no API key in test environment
    const originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    try {
      const result = await generateMigrationGuide(sampleChanges, sampleFindings, {
        apiKey: undefined,
        client: undefined,
      });

      expect(result.isAiGenerated).toBe(false);
      expect(result.provider).toBe('fallback');
      expect(result.executiveSummary).toContain('1 contract breaking change(s)');
      expect(result.migrationSteps).toHaveLength(1);
      expect(result.migrationSteps[0].property).toBe('university');
      expect(result.migrationSteps[0].afterSnippet).toContain('/* TODO: replace .university */');
      expect(result.markdown).toContain('Deterministic Fallback Guide');
    } finally {
      if (originalKey) process.env.GROQ_API_KEY = originalKey;
    }
  });

  it('gracefully catches LLM API failure and returns fallback without throwing', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue(new Error('Rate limit exceeded (429)')),
        },
      },
    };

    const result = await generateMigrationGuide(sampleChanges, sampleFindings, {
      client: mockClient,
    });

    expect(result.isAiGenerated).toBe(false);
    expect(result.provider).toBe('fallback');
    expect(result.error).toContain('Rate limit exceeded (429)');
    expect(result.migrationSteps).toHaveLength(1);
  });

  it('correctly formats migration results into GitHub-flavored Markdown', () => {
    const mockResult: MigrationGuideResult = {
      executiveSummary: 'Schema field changed.',
      migrationSteps: [
        {
          filePath: 'src/app.ts',
          lineNumber: 4,
          property: 'email',
          instruction: 'Update email access.',
          beforeSnippet: 'user.email',
          afterSnippet: 'user.primaryEmail',
        },
      ],
      markdown: '',
      isAiGenerated: true,
      provider: 'groq',
    };

    const md = formatMigrationMarkdown(mockResult);
    expect(md).toContain('<details open>');
    expect(md).toContain('`src/app.ts` (Line 4)');
    expect(md).toContain('**Suggested Migration:**');
    expect(md).toContain('user.primaryEmail');
  });

  it('supports backwards-compatible generateSummary helper', async () => {
    const summaryMd = await generateSummary(sampleChanges, sampleFindings);
    expect(typeof summaryMd).toBe('string');
    expect(summaryMd).toContain('<details open>');
  });
});

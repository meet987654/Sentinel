import Groq from 'groq-sdk';
import { BreakingChange, ConsumerFinding, ChangeReport } from '../types.js';

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export async function generateSummary(
  changes: BreakingChange[],
  findings: ConsumerFinding[]
): Promise<string> {
  const breakingChanges = changes.filter(c => c.severity === 'breaking');
  
  if (breakingChanges.length === 0) {
    return "No breaking changes detected.";
  }

  const prompt = `
You are an expert API developer assisting in a code review.
I have detected breaking changes in an OpenAPI schema and scanned the TypeScript codebase for potential affected code.

Here is the raw data:
Breaking Changes:
${JSON.stringify(breakingChanges, null, 2)}

Affected Source Code Findings (Medium Confidence):
${JSON.stringify(findings, null, 2)}

Write exactly one concise paragraph explaining what broke and what will likely be affected in the codebase.
Following the paragraph, provide a one or two sentence migration suggestion (e.g. "Consider deprecating the field for one release first.").
Do not use markdown lists. Do not say "Here is the summary". Just write the text.
`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      model: 'llama3-8b-8192', // or any preferred groq model
      temperature: 0.2,
    });

    return chatCompletion.choices[0]?.message?.content || 'Summary generation failed.';
  } catch (error) {
    console.error('Groq LLM Error:', error);
    return 'Summary generation failed due to an LLM error.';
  }
}

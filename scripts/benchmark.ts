import { Project } from 'ts-morph';
import { analyzeConsumersFromProject } from '../src/analyzer/tsMorph.js';
import { BreakingChange } from '../src/types.js';

interface BenchmarkResult {
  fileCount: number;
  scanTimeMs: number;
  findingsCount: number;
  memoryUsedMb: number;
}

const SAMPLE_CHANGES: BreakingChange[] = [
  {
    type: 'FIELD_REMOVED',
    severity: 'breaking',
    path: 'GET /users.response.200.email',
  },
  {
    type: 'FIELD_REMOVED',
    severity: 'breaking',
    path: 'GET /members.response.200.university',
  }
];

function generateTypeScriptFileContent(index: number, hasHit: boolean): string {
  if (hasHit) {
    if (index % 2 === 0) {
      return `
import { User } from './types';

export function getUserContact(user: User) {
  console.log("Processing user profile...");
  const userEmail = user.email;
  return {
    id: user.id,
    contact: userEmail,
  };
}
`;
    } else {
      return `
import { Member } from './types';

export function renderMemberCard(member: Member) {
  const { university, name } = member;
  return \`<div>\${name} - \${university}</div>\`;
}
`;
    }
  }

  // Non-hit dummy source file with realistic AST structure
  return `
export interface ItemPayload {
  id: string;
  name: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export class ServiceHandler_${index} {
  private cache = new Map<string, ItemPayload>();

  public processItem(item: ItemPayload): boolean {
    if (!item.id || item.timestamp < 0) {
      return false;
    }
    this.cache.set(item.id, item);
    return true;
  }

  public getItem(id: string): ItemPayload | undefined {
    return this.cache.get(id);
  }
}
`;
}

function runBenchmarkForNFiles(n: number): BenchmarkResult {
  const project = new Project({ useInMemoryFileSystem: true });

  // Add a common types file
  project.createSourceFile('types.ts', `
    export interface User { id: string; name: string; email: string; }
    export interface Member { id: string; name: string; university: string; }
  `);

  // Approximately 15% of files contain target breaking change accesses
  for (let i = 0; i < n; i++) {
    const hasHit = i % 7 === 0;
    const code = generateTypeScriptFileContent(i, hasHit);
    project.createSourceFile(`src/service_${i}.ts`, code);
  }

  const startMem = process.memoryUsage().heapUsed;
  const startTime = performance.now();

  const findings = analyzeConsumersFromProject(project, SAMPLE_CHANGES);

  const endTime = performance.now();
  const endMem = process.memoryUsage().heapUsed;

  return {
    fileCount: n,
    scanTimeMs: Math.round((endTime - startTime) * 100) / 100,
    findingsCount: findings.length,
    memoryUsedMb: Math.round(((endMem - startMem) / (1024 * 1024)) * 100) / 100,
  };
}

console.log('🚀 Running Sentinel AST Benchmarks on local system...\n');

const testSizes = [10, 50, 100, 250, 500, 1000, 2000];
const results: BenchmarkResult[] = [];

for (const n of testSizes) {
  // Warmup small run
  if (n === 10) runBenchmarkForNFiles(5);

  const res = runBenchmarkForNFiles(n);
  results.push(res);
  console.log(`✓ N = ${res.fileCount.toString().padStart(3, ' ')} files: scanTime = ${res.scanTimeMs.toFixed(2).padStart(7, ' ')} ms | findings = ${res.findingsCount.toString().padStart(3, ' ')} | heap = ${res.memoryUsedMb.toFixed(2)} MB`);
}

console.log('\n--- Markdown Table ---');
console.log('| File Count (N) | AST Scan Time (ms) | Scan Time (s) | Findings Detected |');
console.log('| :---: | :---: | :---: | :---: |');
for (const r of results) {
  console.log(`| **${r.fileCount}** | \`${r.scanTimeMs} ms\` | \`${(r.scanTimeMs / 1000).toFixed(3)} s\` | \`${r.findingsCount}\` |`);
}

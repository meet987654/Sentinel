import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import { parseOpenApi } from '../schema/parser.js';
import { diffSchemas } from '../schema/differ.js';
import { analyzeConsumers } from '../analyzer/tsMorph.js';
import { parseConfig, SentinelConfig } from '../config.js';
import { BreakingChange, ConsumerFinding, ChangeReport } from '../types.js';

export interface CliOptions {
  schema?: string;
  baseSchema?: string;
  workspace?: string;
  config?: string;
  failOnBreakage?: boolean;
  json?: boolean;
}

export async function runCli(argv: string[]): Promise<{ exitCode: number; report: ChangeReport }> {
  const program = new Command();

  let options: CliOptions = {};

  program
    .name('sentinel')
    .description('Sentinel — Automated API Impact Analyzer CLI')
    .version('1.0.0')
    .option('-s, --schema <path>', 'Path to PR/head OpenAPI schema specification file', 'openapi.yaml')
    .option('-b, --base-schema <path>', 'Path to base OpenAPI schema specification file for diffing')
    .option('-w, --workspace <path>', 'Path to consumer codebase directory', '.')
    .option('-c, --config <path>', 'Path to .sentinel.yml repository configuration file', '.sentinel.yml')
    .option('-f, --fail-on-breakage', 'Exit with code 1 if breaking API contract changes or consumer impacts are found', false)
    .option('-j, --json', 'Output results in JSON format', false)
    .action((opts) => {
      options = opts;
    });

  program.parse(argv);

  const workspaceDir = path.resolve(process.cwd(), options.workspace || '.');
  
  // 1. Load Configuration
  let config: SentinelConfig = parseConfig();
  const configPath = path.resolve(workspaceDir, options.config || '.sentinel.yml');
  if (fs.existsSync(configPath)) {
    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      config = parseConfig(configContent);
    } catch {
      // Fallback to default
    }
  }

  const schemaPath = options.schema || config.schemaPath || 'openapi.yaml';
  const headSchemaFullPath = path.resolve(workspaceDir, schemaPath);

  let changes: BreakingChange[] = [];
  let findings: ConsumerFinding[] = [];

  if (!fs.existsSync(headSchemaFullPath)) {
    const errorMsg = `Error: Head OpenAPI schema file not found at path: ${headSchemaFullPath}`;
    if (options.json) {
      console.log(JSON.stringify({ error: errorMsg, changes: [], findings: [] }, null, 2));
    } else {
      console.error(`❌ ${errorMsg}`);
    }
    return { exitCode: 1, report: { changes: [], findings: [], summary: errorMsg } };
  }

  const headContent = fs.readFileSync(headSchemaFullPath, 'utf8');
  const headSchema = await parseOpenApi(headContent, schemaPath);

  if (options.baseSchema) {
    const baseSchemaFullPath = path.resolve(workspaceDir, options.baseSchema);
    if (fs.existsSync(baseSchemaFullPath)) {
      const baseContent = fs.readFileSync(baseSchemaFullPath, 'utf8');
      const baseSchemaObj = await parseOpenApi(baseContent, options.baseSchema);
      changes = diffSchemas(baseSchemaObj, headSchema);
    } else {
      console.warn(`⚠️ Warning: Base schema file not found at ${baseSchemaFullPath}. Skipping diffing.`);
    }
  }

  if (changes.length > 0) {
    findings = analyzeConsumers(workspaceDir, changes, config.ignorePaths);
  }

  const report: ChangeReport = {
    changes,
    findings,
    summary: `Sentinel CLI analyzed ${changes.length} schema changes across ${workspaceDir}`,
  };

  const breakingCount = changes.filter(c => c.severity === 'breaking').length;
  const exitCode = (options.failOnBreakage && (breakingCount > 0 || findings.length > 0)) ? 1 : 0;

  if (options.json) {
    console.log(JSON.stringify({ report, exitCode }, null, 2));
  } else {
    printCliTerminalOutput(report, options, schemaPath, workspaceDir);
  }

  return { exitCode, report };
}

function printCliTerminalOutput(
  report: ChangeReport,
  options: CliOptions,
  schemaPath: string,
  workspaceDir: string
) {
  console.log(`\n🛡️  Sentinel — Automated API Impact Analyzer`);
  console.log(`=======================================================`);
  console.log(`📄 Schema File : ${schemaPath}`);
  console.log(`📂 Workspace   : ${workspaceDir}\n`);

  if (report.changes.length === 0) {
    console.log(`✅ No contract diff changes detected.\n`);
    return;
  }

  const breakingCount = report.changes.filter(c => c.severity === 'breaking').length;
  console.log(`⚠️  Detected ${report.changes.length} Contract Change(s) (${breakingCount} Breaking):\n`);

  for (const change of report.changes) {
    const icon = change.severity === 'breaking' ? '❌' : '⚠️ ';
    console.log(`  ${icon} [${change.severity.toUpperCase()}] ${change.path} (${change.type})`);
  }

  console.log(`\n🔍 Consumer AST Findings (${report.findings.length}):\n`);
  if (report.findings.length === 0) {
    console.log(`  *No consumer usages found in workspace.*\n`);
  } else {
    for (const finding of report.findings) {
      console.log(`  📍 [${finding.confidence.toUpperCase()}] ${finding.filePath}:${finding.lineNumber}`);
      console.log(`     Snippet: ${finding.snippet}\n`);
    }
  }

  if (options.failOnBreakage && breakingCount > 0) {
    console.log(`❌ CLI Execution Failed: --fail-on-breakage set and breaking API changes were detected.\n`);
  }
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runCli } from '../src/cli/index.js';
import fs from 'fs';
import path from 'path';

describe('Standalone CLI Runner Mode (runCli)', () => {
  const tmpDir = path.resolve(process.cwd(), 'scratch/cli-test-temp');

  const cleanTmpDir = () => {
    try {
      if (fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    } catch {
      // Ignore Windows transient lock
    }
  };

  beforeEach(() => {
    cleanTmpDir();
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir();
  });

  it('should return exit code 1 when schema file is missing', async () => {
    const { exitCode, report } = await runCli([
      'node', 'sentinel',
      '-s', 'missing-schema.yaml',
      '-w', tmpDir,
      '--json'
    ]);

    expect(exitCode).toBe(1);
    expect(report.summary).toContain('Head OpenAPI schema file not found');
  });

  it('should parse schema and return exit code 0 when no breaking changes exist', async () => {
    const schemaPath = path.join(tmpDir, 'openapi.yaml');
    fs.writeFileSync(schemaPath, `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  email:
                    type: string
`);

    const { exitCode, report } = await runCli([
      'node', 'sentinel',
      '-s', 'openapi.yaml',
      '-w', tmpDir,
      '--json'
    ]);

    expect(exitCode).toBe(0);
    expect(report.changes).toHaveLength(0);
  });

  it('should detect breaking changes and exit code 1 when --fail-on-breakage is set', async () => {
    const baseSchemaPath = path.join(tmpDir, 'base.yaml');
    const headSchemaPath = path.join(tmpDir, 'head.yaml');

    fs.writeFileSync(baseSchemaPath, `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  email:
                    type: string
`);

    fs.writeFileSync(headSchemaPath, `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
paths:
  /users:
    get:
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  user_email:
                    type: string
`);

    // Create a consumer TypeScript file referencing removed 'email'
    fs.writeFileSync(path.join(tmpDir, 'consumer.ts'), `
      export function renderUser(user: { email: string }) {
        return user.email;
      }
    `);

    const { exitCode, report } = await runCli([
      'node', 'sentinel',
      '-s', 'head.yaml',
      '-b', 'base.yaml',
      '-w', tmpDir,
      '-f',
      '--json'
    ]);

    expect(exitCode).toBe(1);
    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].type).toBe('FIELD_REMOVED');
    expect(report.findings.length).toBeGreaterThan(0);
  });
});

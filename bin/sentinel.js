#!/usr/bin/env node

import { runCli } from '../dist/cli/index.js';

runCli(process.argv)
  .then(({ exitCode }) => {
    process.exit(exitCode);
  })
  .catch((err) => {
    console.error('❌ Sentinel CLI Fatal Error:', err);
    process.exit(1);
  });

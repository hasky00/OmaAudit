#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`omaaudit: ${err && err.stack ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  });

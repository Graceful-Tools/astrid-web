#!/usr/bin/env node
import { runCli } from './cli.js'

runCli(process.argv.slice(2), {
  env: process.env,
  stdout: line => process.stdout.write(`${line}\n`),
  stderr: line => process.stderr.write(`${line}\n`),
}).then(
  code => { process.exitCode = code },
  error => {
    process.stderr.write(`astrid-agent: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  },
)

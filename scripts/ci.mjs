#!/usr/bin/env node
/**
 * Local equivalent of the CI `backend` job.
 *
 * Runs the exact sequence the workflow executes, so the pipeline can be verified on a machine
 * that has Postgres and Redis available (docker compose) even before the repository is on GitHub.
 */
import { execSync } from 'node:child_process';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://notifhub:notifhub_pass@localhost:5432/notifhub_test';

const steps = [
  { name: 'typecheck backend', command: 'npm run typecheck' },
  { name: 'build backend', command: 'npm run build' },
  { name: 'siapkan database + redis test', command: 'npm run test:db:setup' },
  { name: 'e2e (jest)', command: 'npm run test:e2e -- --runInBand' },
  {
    name: 'status migrasi database test',
    command: 'npx prisma migrate status',
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
];

const started = Date.now();

for (const [index, step] of steps.entries()) {
  console.log(`\n=== [${index + 1}/${steps.length}] ${step.name} ===`);

  try {
    execSync(step.command, {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, ...step.env },
    });
  } catch {
    console.error(`\nCI gagal pada langkah: ${step.name}`);
    process.exit(1);
  }
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(`\nCI backend lulus dalam ${seconds}s (${steps.length} langkah).`);

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const allowed = new Set(['src/utils/logger.ts']);
const ignoredDirs = new Set([
  '.git',
  'dist',
  'node_modules',
  'coverage',
  '.tmp',
]);
const consolePattern = /\bconsole\.(log|info|warn|error|debug|trace)\b/;
const failures = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) {
      continue;
    }

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (!fullPath.endsWith('.ts') && !fullPath.endsWith('.js')) {
      continue;
    }

    const rel = relative(root, fullPath);
    if (allowed.has(rel)) {
      continue;
    }

    const lines = readFileSync(fullPath, 'utf-8').split('\n');
    lines.forEach((line, index) => {
      if (consolePattern.test(line)) {
        failures.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    });
  }
}

walk(join(root, 'src'));

if (failures.length > 0) {
  console.error('Unexpected console usage outside src/utils/logger.ts:');
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

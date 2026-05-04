import * as fs from 'node:fs';
import * as path from 'node:path';

const packageRoot = process.cwd();
const distDir = path.join(packageRoot, 'dist');
const forbidden = '@anthropic-ai/claude-agent-sdk';

if (!fs.existsSync(distDir)) {
  console.error('dist/ does not exist. Run npm run build first.');
  process.exit(1);
}

const leaks = [];

function visitDir(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      visitDir(fullPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.d.ts')) {
      continue;
    }
    const source = fs.readFileSync(fullPath, 'utf8');
    if (source.includes(forbidden)) {
      leaks.push(path.relative(packageRoot, fullPath));
    }
  }
}

visitDir(distDir);

if (leaks.length > 0) {
  console.error(
    `Public declarations must not import ${forbidden}. Leaks found in:`,
  );
  for (const leak of leaks) {
    console.error(`- ${leak}`);
  }
  process.exit(1);
}

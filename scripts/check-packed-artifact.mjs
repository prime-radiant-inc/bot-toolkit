import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';

const packageRoot = process.cwd();
const checkDir = join(packageRoot, '.tmp', 'pack-artifact-check');
const unpackDir = join(checkDir, 'unpacked');
const privateString = 'claude-pa';
const generatedInstructionPatterns = [
  /read from other rooms/i,
  /MCP data/i,
  /mcp-data/i,
  /repos\//i,
  /infrastructure\//i,
  /This is your sandbox/i,
  /grep[\s\S]{0,80}rooms\/\*\/chat-history/i,
];
const tarBlockSize = 512;
let cleanupFailureReported = false;

function cleanupCheckDir() {
  try {
    rmSync(checkDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (!cleanupFailureReported) {
      console.error(
        `Warning: failed to clean ${relative(packageRoot, checkDir)}: ${error.message}`,
      );
      cleanupFailureReported = true;
    }
    return false;
  }
}

function fail(message, details = []) {
  console.error(message);
  for (const detail of details) {
    console.error(`- ${detail}`);
  }
  cleanupCheckDir();
  process.exit(1);
}

function getNpmInvocation() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath],
    };
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: [],
  };
}

function walkFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }

    if (stat.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function readTarString(buffer, start, length) {
  const value = buffer.toString('utf8', start, start + length);
  const nullIndex = value.indexOf('\0');
  return nullIndex === -1 ? value : value.slice(0, nullIndex);
}

function readTarOctal(buffer, start, length) {
  const value = readTarString(buffer, start, length).trim();
  if (value === '') {
    return 0;
  }

  const parsed = Number.parseInt(value, 8);
  if (Number.isNaN(parsed)) {
    fail('Packed artifact tar contains an invalid octal size field.', [value]);
  }

  return parsed;
}

function isZeroBlock(buffer) {
  return buffer.every((byte) => byte === 0);
}

function safeTarPath(entryName) {
  const normalized = entryName.replaceAll('\\', '/').replace(/\/+$/, '');
  if (
    normalized === '' ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    fail('Packed artifact tar contains an unsafe path.', [entryName]);
  }

  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '..')) {
    fail('Packed artifact tar contains an unsafe path.', [entryName]);
  }

  return normalized;
}

function outputPathForTarEntry(entryName) {
  const safePath = safeTarPath(entryName);
  const outputPath = resolve(unpackDir, ...safePath.split('/'));
  const unpackRoot = resolve(unpackDir);

  if (
    outputPath !== unpackRoot &&
    !outputPath.startsWith(`${unpackRoot}${sep}`)
  ) {
    fail('Packed artifact tar path escapes the unpack directory.', [entryName]);
  }

  return outputPath;
}

function unpackTarGzip(archivePath) {
  let tarBuffer;
  try {
    tarBuffer = gunzipSync(readFileSync(archivePath));
  } catch (error) {
    fail('Failed to gunzip npm packed artifact.', [error.message]);
  }

  for (let offset = 0; offset < tarBuffer.length; offset += tarBlockSize) {
    const header = tarBuffer.subarray(offset, offset + tarBlockSize);
    if (header.length < tarBlockSize || isZeroBlock(header)) {
      return;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryName = prefix ? `${prefix}/${name}` : name;
    const size = readTarOctal(header, 124, 12);
    const typeFlag = readTarString(header, 156, 1);
    const dataStart = offset + tarBlockSize;
    const dataEnd = dataStart + size;
    const outputPath = outputPathForTarEntry(entryName);

    if (dataEnd > tarBuffer.length) {
      fail('Packed artifact tar entry extends beyond archive bounds.', [
        entryName,
      ]);
    }

    if (typeFlag === '' || typeFlag === '0') {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, tarBuffer.subarray(dataStart, dataEnd));
    } else if (typeFlag === '5') {
      mkdirSync(outputPath, { recursive: true });
    } else {
      fail('Packed artifact tar contains an unsupported entry type.', [
        `${entryName} (type ${typeFlag})`,
      ]);
    }

    offset += Math.ceil(size / tarBlockSize) * tarBlockSize;
  }
}

if (!cleanupCheckDir()) {
  fail('Failed to prepare packed artifact check directory.');
}

try {
  mkdirSync(unpackDir, { recursive: true });
} catch (error) {
  fail('Failed to prepare packed artifact check directory.', [error.message]);
}

let packResult;
try {
  const npmInvocation = getNpmInvocation();
  const output = execFileSync(
    npmInvocation.command,
    [...npmInvocation.args, 'pack', '--json', '--pack-destination', checkDir],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  packResult = JSON.parse(output);
} catch (error) {
  fail('Failed to create npm packed artifact.', [error.message]);
}

const packedFilename = packResult?.[0]?.filename;
if (!packedFilename) {
  fail('npm pack did not return a packed artifact filename.');
}

const packedArtifact = join(checkDir, packedFilename);
if (!existsSync(packedArtifact)) {
  fail('npm pack reported an artifact that was not found.', [
    relative(packageRoot, packedArtifact),
  ]);
}

unpackTarGzip(packedArtifact);

const unpackedPackageDir = join(unpackDir, 'package');
if (!existsSync(unpackedPackageDir)) {
  fail('Packed artifact did not unpack to the expected package/ directory.');
}

const privateStringMatches = [];
for (const file of walkFiles(unpackedPackageDir)) {
  const contents = readFileSync(file, 'utf8');
  if (contents.includes(privateString)) {
    privateStringMatches.push(relative(unpackedPackageDir, file));
  }
}

if (privateStringMatches.length > 0) {
  fail(
    `Packed artifact contains private string "${privateString}" in packaged files.`,
    privateStringMatches,
  );
}

const builtRoomPathFile = join(
  unpackedPackageDir,
  'dist',
  'utils',
  'roomPath.js',
);
if (!existsSync(builtRoomPathFile)) {
  fail('Packed artifact is missing dist/utils/roomPath.js.');
}

const builtRoomPath = readFileSync(builtRoomPathFile, 'utf8');
const generatedInstructionMatches = generatedInstructionPatterns
  .filter((pattern) => pattern.test(builtRoomPath))
  .map((pattern) => pattern.toString());

if (generatedInstructionMatches.length > 0) {
  fail(
    'Packed artifact dist/utils/roomPath.js contains forbidden generated-instruction patterns.',
    generatedInstructionMatches,
  );
}

if (!cleanupCheckDir()) {
  fail('Packed artifact passed scans but cleanup failed.');
}

console.log(
  `Packed artifact ${packedFilename} passed generated-instruction scan.`,
);

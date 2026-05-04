import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { processOutbox } from '../outbox.js';

describe('processOutbox', () => {
  let roomDir: string;
  let outboxDir: string;
  let sentDir: string;

  beforeEach(() => {
    roomDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-test-'));
    outboxDir = path.join(roomDir, 'outbox');
    sentDir = path.join(outboxDir, 'sent');
  });

  afterEach(() => {
    fs.rmSync(roomDir, { recursive: true, force: true });
  });

  it('should no-op when outbox directory does not exist', async () => {
    const sendFile = vi.fn();
    await processOutbox(roomDir, sendFile);
    expect(sendFile).not.toHaveBeenCalled();
  });

  it('should no-op when outbox directory is empty', async () => {
    fs.mkdirSync(outboxDir);
    const sendFile = vi.fn();
    await processOutbox(roomDir, sendFile);
    expect(sendFile).not.toHaveBeenCalled();
  });

  it('should send a single file and move it to sent/', async () => {
    fs.mkdirSync(outboxDir);
    const filePath = path.join(outboxDir, 'report.pdf');
    fs.writeFileSync(filePath, 'pdf contents');

    const sendFile = vi.fn();
    await processOutbox(roomDir, sendFile);

    expect(sendFile).toHaveBeenCalledOnce();
    expect(sendFile).toHaveBeenCalledWith(filePath, 'report.pdf');

    // Original file should be gone
    expect(fs.existsSync(filePath)).toBe(false);

    // Should be in sent/ with timestamp prefix
    const sentFiles = fs.readdirSync(sentDir);
    expect(sentFiles).toHaveLength(1);
    expect(sentFiles[0]).toMatch(/^\d+-report\.pdf$/);
    expect(fs.readFileSync(path.join(sentDir, sentFiles[0]), 'utf-8')).toBe(
      'pdf contents',
    );
  });

  it('should send multiple files in sorted order', async () => {
    fs.mkdirSync(outboxDir);
    fs.writeFileSync(path.join(outboxDir, 'c-third.txt'), '3');
    fs.writeFileSync(path.join(outboxDir, 'a-first.txt'), '1');
    fs.writeFileSync(path.join(outboxDir, 'b-second.txt'), '2');

    const callOrder: string[] = [];
    const sendFile = vi.fn().mockImplementation((filePath: string) => {
      callOrder.push(path.basename(filePath));
    });

    await processOutbox(roomDir, sendFile);

    expect(sendFile).toHaveBeenCalledTimes(3);
    expect(callOrder).toEqual(['a-first.txt', 'b-second.txt', 'c-third.txt']);

    // All moved to sent/
    const remaining = fs.readdirSync(outboxDir).filter((f) => f !== 'sent');
    expect(remaining).toHaveLength(0);
    expect(fs.readdirSync(sentDir)).toHaveLength(3);
  });

  it('should continue sending remaining files when one fails', async () => {
    fs.mkdirSync(outboxDir);
    fs.writeFileSync(path.join(outboxDir, 'a-ok.txt'), 'ok');
    fs.writeFileSync(path.join(outboxDir, 'b-fail.txt'), 'fail');
    fs.writeFileSync(path.join(outboxDir, 'c-ok.txt'), 'ok');

    const sendFile = vi.fn().mockImplementation((filePath: string) => {
      if (path.basename(filePath) === 'b-fail.txt') {
        throw new Error('upload failed');
      }
    });

    await processOutbox(roomDir, sendFile);

    expect(sendFile).toHaveBeenCalledTimes(3);

    // Failed file should still be in outbox
    expect(fs.existsSync(path.join(outboxDir, 'b-fail.txt'))).toBe(true);

    // Successful files should be in sent/
    const sentFiles = fs.readdirSync(sentDir);
    expect(sentFiles).toHaveLength(2);
    expect(sentFiles.some((f) => f.includes('a-ok.txt'))).toBe(true);
    expect(sentFiles.some((f) => f.includes('c-ok.txt'))).toBe(true);
  });

  it('should exclude sent/ subdirectory from file list', async () => {
    fs.mkdirSync(outboxDir);
    fs.mkdirSync(sentDir);
    fs.writeFileSync(path.join(sentDir, 'old-file.txt'), 'old');
    fs.writeFileSync(path.join(outboxDir, 'new-file.txt'), 'new');

    const sendFile = vi.fn();
    await processOutbox(roomDir, sendFile);

    expect(sendFile).toHaveBeenCalledOnce();
    expect(sendFile).toHaveBeenCalledWith(
      path.join(outboxDir, 'new-file.txt'),
      'new-file.txt',
    );
  });

  it('should exclude nested directories from file list', async () => {
    fs.mkdirSync(outboxDir);
    fs.mkdirSync(path.join(outboxDir, 'subdir'));
    fs.writeFileSync(path.join(outboxDir, 'subdir', 'nested.txt'), 'nested');
    fs.writeFileSync(path.join(outboxDir, 'top-level.txt'), 'top');

    const sendFile = vi.fn();
    await processOutbox(roomDir, sendFile);

    expect(sendFile).toHaveBeenCalledOnce();
    expect(sendFile).toHaveBeenCalledWith(
      path.join(outboxDir, 'top-level.txt'),
      'top-level.txt',
    );
  });
});

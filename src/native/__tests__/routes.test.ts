import express from 'express';
import type { Server } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNativeRoutes } from '../routes.js';
import { NativeSessionManager } from '../sessionManager.js';

async function listen(app: express.Express) {
  return new Promise<Server>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function baseUrl(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('missing port');
  }
  return `http://127.0.0.1:${address.port}`;
}

describe('createNativeRoutes', () => {
  let tempDir: string;
  let manager: NativeSessionManager;
  let server: Server | undefined;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-routes-test-'));
    manager = new NativeSessionManager(tempDir);
  });

  afterEach(async () => {
    if (server) {
      await close(server);
      server = undefined;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not disclose the session filesystem directory in session responses', async () => {
    const session = await manager.createSession();
    const app = express();
    app.use(express.json());
    app.use(createNativeRoutes(manager));
    server = await listen(app);

    const response = await fetch(`${baseUrl(server)}/sessions/${session.id}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ id: session.id });
    expect(body).not.toHaveProperty('directory');
    expect(JSON.stringify(body)).not.toContain(tempDir);
  });

  it('rejects empty native room slugs', async () => {
    const app = express();
    app.use(express.json());
    app.use(createNativeRoutes(manager));
    server = await listen(app);

    const response = await fetch(`${baseUrl(server)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: '   ', name: 'Room' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'slug and name cannot be empty',
    });
  });

  it('rejects native room slugs that sanitize to empty', async () => {
    const app = express();
    app.use(express.json());
    app.use(createNativeRoutes(manager));
    server = await listen(app);

    const response = await fetch(`${baseUrl(server)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: '!!!', name: 'Room' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'slug must contain at least one filesystem-safe character',
    });
  });

  it('rejects non-string native room payloads', async () => {
    const app = express();
    app.use(express.json());
    app.use(createNativeRoutes(manager));
    server = await listen(app);

    const response = await fetch(`${baseUrl(server)}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 123, name: 'Room' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'slug and name are required',
    });
  });
});

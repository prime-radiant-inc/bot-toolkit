// packages/bot-toolkit/src/native/routes.ts

import { Router } from 'express';
import { Logger } from '../utils/logger.js';
import { getRoomDirectory } from '../utils/roomPath.js';
import type { NativeSessionManager } from './sessionManager.js';

const logger = new Logger('NativeRoutes');

export function createNativeRoutes(
  sessionManager: NativeSessionManager,
): Router {
  const router = Router();

  // List all sessions
  router.get('/sessions', async (_req, res) => {
    try {
      const sessions = await sessionManager.listSessions();
      res.json({
        sessions: sessions.map((s) => ({
          id: s.id,
          created_at: s.createdAt.toISOString(),
          last_activity: s.lastActivity.toISOString(),
          attached: sessionManager.isAttached(s.id),
          sdk_session_id: s.sdkSessionId,
        })),
      });
    } catch (error) {
      logger.error('Failed to list sessions', { error });
      res.status(500).json({ error: 'Failed to list sessions' });
    }
  });

  // Create new session
  router.post('/sessions', async (_req, res) => {
    try {
      const session = await sessionManager.createSession();
      res.status(201).json({
        id: session.id,
        created_at: session.createdAt.toISOString(),
      });
    } catch (error) {
      logger.error('Failed to create session', { error });
      res.status(500).json({ error: 'Failed to create session' });
    }
  });

  // Get session by ID
  router.get('/sessions/:id', async (req, res) => {
    try {
      const session = await sessionManager.getSession(req.params.id);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({
        id: session.id,
        created_at: session.createdAt.toISOString(),
        last_activity: session.lastActivity.toISOString(),
        attached: sessionManager.isAttached(session.id),
        sdk_session_id: session.sdkSessionId,
      });
    } catch (error) {
      logger.error('Failed to get session', { error, id: req.params.id });
      res.status(500).json({ error: 'Failed to get session' });
    }
  });

  // Delete session
  router.delete('/sessions/:id', async (req, res) => {
    try {
      await sessionManager.deleteSession(req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      logger.error('Failed to delete session', { error, id: req.params.id });
      res.status(500).json({ error: 'Failed to delete session' });
    }
  });

  // Create a native room
  router.post('/rooms', (req, res) => {
    try {
      const { slug, name } = req.body as { slug?: unknown; name?: unknown };
      if (typeof slug !== 'string' || typeof name !== 'string') {
        res.status(400).json({ error: 'slug and name are required' });
        return;
      }
      if (slug.trim().length === 0 || name.trim().length === 0) {
        res.status(400).json({ error: 'slug and name cannot be empty' });
        return;
      }

      getRoomDirectory(sessionManager.dataDir, slug, 'native', {
        platform: 'native',
        channelId: slug,
        channelName: name,
      });

      logger.info('Created native room', { slug, name });
      res.status(201).json({ slug, name });
    } catch (error) {
      logger.error('Failed to create room', { error });
      res.status(500).json({ error: 'Failed to create room' });
    }
  });

  return router;
}

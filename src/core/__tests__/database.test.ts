import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionDatabase } from '../database';

describe('SessionDatabase', () => {
  let db: SessionDatabase;

  beforeEach(() => {
    db = new SessionDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('deleteEventProcessed', () => {
    it('deletes a previously processed event', () => {
      db.markEventProcessed('evt-1', 'room-1');
      expect(db.isEventProcessed('evt-1')).toBe(true);

      db.deleteEventProcessed('evt-1');
      expect(db.isEventProcessed('evt-1')).toBe(false);
    });

    it('is a no-op for non-existent events', () => {
      db.deleteEventProcessed('non-existent');
    });
  });
});

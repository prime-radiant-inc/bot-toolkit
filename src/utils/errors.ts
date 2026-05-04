export class BotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BotError';
  }
}

export class DatabaseError extends BotError {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class ClaudeSessionError extends BotError {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeSessionError';
  }
}

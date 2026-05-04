import type { PlatformResponder } from './types.js';

export type SlashCommand = 'clear' | 'compact' | 'new';

export interface Command {
  command: SlashCommand;
  args: string;
}

export class CommandHandler {
  private readonly validCommands: Set<SlashCommand> = new Set([
    'clear',
    'compact',
    'new',
  ]);

  parse(message: string): Command | null {
    const match = message.match(/^\/(\w+)(?:\s+(.*))?$/);
    if (!match) return null;

    const cmd = match[1]?.toLowerCase();
    if (!cmd || !this.validCommands.has(cmd as SlashCommand)) {
      return null;
    }

    return {
      command: cmd as SlashCommand,
      args: match[2]?.trim() ?? '',
    };
  }

  async handle(cmd: Command, responder: PlatformResponder): Promise<boolean> {
    switch (cmd.command) {
      case 'new': {
        const topic = cmd.args || 'New conversation';
        await responder.createThreadStarter(topic);
        return true;
      }

      case 'clear':
        await responder.sendNotice(
          'The /clear command is not available in SDK mode. Start a new thread instead.',
        );
        return true;

      case 'compact':
        await responder.sendNotice(
          'The /compact command is not available in SDK mode. Compaction is automatic.',
        );
        return true;

      default:
        return false;
    }
  }
}

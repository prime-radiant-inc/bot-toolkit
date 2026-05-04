# @primeradiant/bot-toolkit

A reusable toolkit for building multi-platform chat bots with Claude. Provides platform-agnostic abstractions for message handling, session management, and response streaming.

## Installation

```bash
pnpm add @primeradiant/bot-toolkit
```

## Key Exports

### Core Classes

- **`BaseAdapter`** - Abstract base class for platform adapters. Handles authorization, message building, and attachment downloads.
- **`BaseResponder`** - Abstract base class for platform responders. Handles response throttling and stats formatting.
- **`ConversationOrchestrator`** - Coordinates message handling, Claude sessions, and thread context.
- **`CommandHandler`** - Parses and handles slash commands (`/new`, `/clear`, `/compact`).
- **`SessionDatabase`** - SQLite database for session persistence and event deduplication.
- **`MessageSessionStore`** - In-memory session state management.

### Types

- **`Platform`** - Supported platforms: `'matrix' | 'slack' | 'cli'`
- **`IncomingMessage`** - Normalized incoming message structure
- **`PlatformAdapter`** - Interface for platform adapters
- **`PlatformResponder`** - Interface for platform responders
- **`SessionStats`** - Token usage and cost statistics
- **`WakeupPayload`** - Scheduled wakeup request structure

### Configuration

- **`loadConfig`** - Load configuration from environment and config files
- **`Config`** - Configuration type definition

### Claude Session Management

- **`ClaudeSessionManagerSDK`** - Manages Claude conversations using the Agent SDK

### Utilities

- **`Logger`** - Structured logging utility
- **`getRoomDirectory`** - Get data directory path for a room
- **`sanitizeRoomId`** - Sanitize room IDs for filesystem paths
- **`findLastSentenceBoundary`** - Find safe text split points for chunking

### Servers

- **`createWakeupServer`** - Create HTTP server for scheduled wakeup requests
- **`startWakeupServer`** - Start the wakeup server with config
- **`DebugStreamer`** - Real-time debug event streaming
- **`RawMessageLogger`** - Log raw platform messages for debugging

## Basic Usage

### Creating a Custom Adapter

To add support for a new platform, extend `BaseAdapter` and `BaseResponder`:

```typescript
import {
  BaseAdapter,
  BaseAdapterConfig,
  BaseResponder,
  Platform,
  SessionStats,
  WakeupPayload,
} from '@primeradiant/bot-toolkit';

// 1. Create a responder for your platform
class MyPlatformResponder extends BaseResponder {
  constructor(private channel: MyPlatformChannel) {
    super();
  }

  async markProcessing(): Promise<void> {
    await this.channel.addReaction('hourglass');
  }

  async clearProcessing(): Promise<void> {
    await this.channel.removeReaction('hourglass');
  }

  async markError(): Promise<void> {
    await this.channel.addReaction('x');
  }

  async sendNotice(text: string): Promise<void> {
    await this.channel.sendMessage(text, { style: 'notice' });
  }

  async sendFile(localPath: string, filename?: string): Promise<void> {
    await this.channel.uploadFile(localPath, filename);
  }

  async setTyping(typing: boolean): Promise<void> {
    await this.channel.setTypingIndicator(typing);
  }

  async updateChannelStats(stats: SessionStats): Promise<void> {
    const topic = this.formatStatsTopic(stats);
    await this.channel.setTopic(topic);
  }

  async createThreadStarter(topic: string): Promise<string> {
    const thread = await this.channel.createThread(topic);
    return thread.id;
  }

  protected async sendNewMessage(text: string): Promise<string> {
    const msg = await this.channel.sendMessage(text);
    return msg.id;
  }

  protected async editMessage(text: string): Promise<void> {
    if (this.currentResponseId) {
      await this.channel.editMessage(this.currentResponseId, text);
    }
  }
}

// 2. Create an adapter for your platform
class MyPlatformAdapter extends BaseAdapter {
  readonly platform: Platform = 'cli'; // or add custom platform

  constructor(config: BaseAdapterConfig, private client: MyPlatformClient) {
    super(config);
  }

  async start(): Promise<void> {
    this.client.on('message', (msg) => this.handlePlatformMessage(msg));
    await this.client.connect();
  }

  async stop(): Promise<void> {
    await this.client.disconnect();
  }

  async handleWakeup(channelId: string, payload: WakeupPayload): Promise<void> {
    const channel = await this.client.getChannel(channelId);
    const responder = new MyPlatformResponder(channel);

    const message = this.buildIncomingMessage({
      channelId,
      channelName: channel.name,
      threadId: payload.thread_id ?? null,
      messageId: `wakeup-${payload.idempotency_key}`,
      senderId: 'system',
      text: payload.prompt,
    });

    await this.orchestrator.handleMessage(message, responder);
  }

  protected async sendUnauthorizedResponse(
    channelId: string,
    messageId: string,
    threadId: string | null
  ): Promise<void> {
    const channel = await this.client.getChannel(channelId);
    await channel.sendMessage('You are not authorized to use this bot.');
  }

  private async handlePlatformMessage(msg: MyPlatformMessage): Promise<void> {
    // Check authorization
    const authorized = await this.checkAuthorizationAndRespond(
      msg.senderId,
      msg.channelId,
      msg.id,
      msg.threadId
    );
    if (!authorized) return;

    // Build normalized message
    const message = this.buildIncomingMessage({
      channelId: msg.channelId,
      channelName: msg.channelName,
      threadId: msg.threadId,
      messageId: msg.id,
      senderId: msg.senderId,
      text: msg.text,
    });

    // Create responder and handle
    const channel = await this.client.getChannel(msg.channelId);
    const responder = new MyPlatformResponder(channel);
    await this.orchestrator.handleMessage(message, responder);
  }
}
```

### Setting Up the Orchestrator

```typescript
import {
  ConversationOrchestrator,
  SessionDatabase,
  MessageSessionStore,
  ClaudeSessionManagerSDK,
  loadConfig,
} from '@primeradiant/bot-toolkit';

const config = loadConfig();

// Initialize database and session store
const database = new SessionDatabase(config.database.path);
const sessionStore = new MessageSessionStore(database.db);

// Initialize Claude session manager
const sessionManager = new ClaudeSessionManagerSDK(config, sessionStore);

// Create orchestrator
const orchestrator = new ConversationOrchestrator({
  dataDir: config.dataDirectory,
  sessionManager,
  database,
});

// Create and start your adapter
// Note: authorizedUsers is platform-specific, configured via env vars
const authorizedUsers = process.env.AUTHORIZED_USERS?.split(',') || [];
const adapter = new MyPlatformAdapter(
  {
    orchestrator,
    authorizedUsers,
    dataDir: config.dataDirectory,
  },
  myPlatformClient
);

await adapter.start();
```

## Reference Implementation

See [claude-pa-bot](../claude-pa-bot) for a complete reference implementation with:

- **Matrix adapter** - Full Matrix protocol support with threads and reactions
- **Slack adapter** - Slack Bolt integration with Socket Mode
- **CLI adapter** - Interactive REPL for testing and debugging

## License

MIT

import { createServer } from './server.ts';
import { ResolveQueue } from './executor.ts';
import type { DaemonConfig } from './types.ts';

/** Default maximum queue depth for serialized resolve tasks. */
const DEFAULT_MAX_QUEUE_DEPTH = 10;

/** Resolve daemon configuration from environment variables. */
function loadConfig(): DaemonConfig {
  const webhookSecret = process.env.SHIORI_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('SHIORI_WEBHOOK_SECRET is required');
    process.exit(1);
  }

  return {
    port: Number(process.env.SHIORI_PORT) || 3000,
    webhookSecret,
    cwd: process.env.SHIORI_CWD || process.cwd(),
    shioriPath: process.env.SHIORI_PATH || 'shiori',
    timeout: (Number(process.env.SHIORI_TIMEOUT) || 60) * 1000,
    maxQueueDepth:
      Number(process.env.SHIORI_MAX_QUEUE_DEPTH) || DEFAULT_MAX_QUEUE_DEPTH,
    journalPath: process.env.SHIORI_JOURNAL_PATH || './shiori-events.jsonl',
  };
}

const config = loadConfig();
const queue = new ResolveQueue(config.maxQueueDepth);
const server = createServer(config, queue);

server.listen(config.port, () => {
  console.log(`[shiori-daemon] listening on port ${config.port}`);
  console.log(`[shiori-daemon] cwd: ${config.cwd}`);
  console.log(`[shiori-daemon] max queue depth: ${config.maxQueueDepth}`);
});

// Graceful shutdown — drain pending resolve tasks before closing
function shutdown(signal: string): void {
  console.log(`[shiori-daemon] ${signal} received, shutting down...`);

  // Stop accepting new connections
  server.close(async () => {
    // Wait for queued resolve tasks to finish
    await queue.drain();
    console.log('[shiori-daemon] server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds if server doesn't close
  setTimeout(() => {
    console.error('[shiori-daemon] forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

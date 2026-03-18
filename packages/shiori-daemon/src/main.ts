import { createServer } from './server.ts';
import type { DaemonConfig } from './types.ts';

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
  };
}

const config = loadConfig();
const server = createServer(config);

server.listen(config.port, () => {
  console.log(`[shiori-daemon] listening on port ${config.port}`);
  console.log(`[shiori-daemon] cwd: ${config.cwd}`);
});

// Graceful shutdown
function shutdown(signal: string): void {
  console.log(`[shiori-daemon] ${signal} received, shutting down...`);
  server.close(() => {
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

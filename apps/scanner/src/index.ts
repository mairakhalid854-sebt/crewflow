import { ClamAvClient } from './clamav.js';
import { loadScannerConfig } from './config.js';
import { createScannerServer } from './server.js';

const config = loadScannerConfig();
const scanner = new ClamAvClient({
  host: config.clamAvHost,
  port: config.clamAvPort,
  timeoutMs: config.clamAvTimeoutMs,
});
const server = createScannerServer(config, scanner);

server.listen(config.port, config.host, () => {
  process.stdout.write(
    JSON.stringify({
      event: 'scanner_started',
      host: config.host,
      port: config.port,
    }) + '\n',
  );
});

function shutdown(): void {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

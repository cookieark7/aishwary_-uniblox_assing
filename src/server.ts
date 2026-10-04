import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';

const server = createApp().listen(config.PORT, () => {
  console.log(`listening on :${config.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

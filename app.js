const dotenv = require('dotenv');
const { createApp } = require('./src/server');

dotenv.config();

const { app, config, persistenceReadyPromise } = createApp();

let server;

async function start() {
  await persistenceReadyPromise;
  server = app.listen(config.port, () => {
    console.log(`GRACE backup operations server listening on port ${config.port}`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received. Shutting down gracefully...`);
    if (!server) {
      process.exit(0);
    }

    server.close((err) => {
      if (err) {
        console.error('Shutdown encountered an error.');
        process.exit(1);
      }
      console.log('HTTP server closed.');
      process.exit(0);
    });

    setTimeout(() => {
      console.error('Forced shutdown after timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error(`Startup failed: ${err?.message || 'unknown error'}`);
    process.exit(1);
  });
}

module.exports = {
  app,
  config,
  start,
};

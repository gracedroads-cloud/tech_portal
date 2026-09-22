const { createServer } = require('./src/server');

async function main() {
  const ops = createServer();
  await ops.start();
  const address = ops.server.address();
  process.stdout.write(`EH Graced Roads Solutions LLC — Isolated Operations Command listening on ${address.port}\n`);

  const shutdown = async () => {
    await ops.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});

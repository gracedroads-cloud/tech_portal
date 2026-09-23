const path = require('path');
const { createServer } = require('./server');

const port = Number(process.env.ISOLATED_OPS_PORT || 4100);
const dataDir = process.env.ISOLATED_OPS_DATA_DIR || path.join(__dirname, '..', 'data');

const { app } = createServer({
  dataDir,
  authToken: process.env.OPS_COMMAND_TOKEN
});

app.listen(port, () => {
  console.log(`[isolated-ops-command] listening on port ${port}`);
});

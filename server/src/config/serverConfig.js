const DEFAULT_PORT = 10000;
const DEFAULT_HOST = '0.0.0.0';

function readServerConfig(env = process.env) {
  const rawPort = env.PORT;
  const port = rawPort === undefined || rawPort === '' ? DEFAULT_PORT : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  const host = env.HOST?.trim() || DEFAULT_HOST;
  return { serverPort: port, serverHost: host };
}

module.exports = { DEFAULT_HOST, DEFAULT_PORT, readServerConfig };

const { readServerConfig } = require('./config/serverConfig');
const { createHttpServer } = require('./httpServer');
const { RoomStore } = require('./rooms/roomStore');
const { createSocketServer } = require('./socket/socketServer');

const roomStore = new RoomStore();
const server = createHttpServer(roomStore);
const io = createSocketServer(server, roomStore);
const { serverPort, serverHost } = readServerConfig();

server.listen(serverPort, serverHost, () => {
  console.info(`Real Life Among Us server listening on ${serverHost}:${serverPort}.`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`${signal} received; shutting down.`);
  const forceTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out; closing remaining connections.');
    server.closeAllConnections?.();
    process.exitCode = 1;
  }, 10000);
  forceTimer.unref();
  io.close(() => {
    clearTimeout(forceTimer);
    console.info('Server shutdown complete.');
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

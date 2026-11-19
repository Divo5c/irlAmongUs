# Real Life Among Us beta

Flutter Android client and Socket.IO/Node game server. See [the Android build guide](scripts/README.md) and [game concept](docs/game-concept.md).

## Current network setup

The server handles lobby membership and authoritative game state. It listens on `0.0.0.0` by default, uses the hosting platform's `PORT` value (default `10000`), and exposes `GET /health` for health checks. Socket.IO accepts WebSocket connections on the same port; HTTPS from the client upgrades to WSS at the host. Release builds reject non-HTTPS and localhost URLs.

The Render Blueprint in `render.yaml` deploys the container as a Frankfurt free web service and checks `/health`. Render supports WebSockets on free web services, but they spin down after 15 minutes without inbound traffic and take about a minute to wake. The free plan is intended for hobby/testing and may be restarted; because the server has no database, active lobbies and sessions disappear on restart. Keep one instance. See [Render free service limits](https://render.com/docs/free) and [Render WebSocket behavior](https://render.com/docs/websocket).

The browser PWA runs on [Render](https://real-life-among-us-beta.onrender.com/). Changes pushed to GitHub's `main` branch are deployed by Render. Follow the [deployment checklist](docs/agent-deploy.md) to verify the live version and send the ntfy notification.

## Run locally

```powershell
cd server
npm ci
npm start
```

Open [http://127.0.0.1:10000/](http://127.0.0.1:10000/) for the browser PWA. Keep the server running while you play.

For Android on the same network, a debug build can use `--dart-define=SERVER_URL=http://<reachable-host>:10000`. For a release build, use the public HTTPS URL, for example `--dart-define=SERVER_URL=https://real-life-among-us-beta.onrender.com`. The client has no localhost fallback.

## Validation

Run server tests with `cd server; npm test`. From `app`, run `flutter analyze`, `flutter test`, and `flutter build apk --release --dart-define=SERVER_URL=https://<your-host>`.

## Agent Deploy

For AI-agent-led deploys (Render + ntfy push to Divo's phone), see [docs/agent-deploy.md](docs/agent-deploy.md). It covers the full flow: syntax check → tests → commit → push → verify `?v=` + health → `scripts/notify.sh`.

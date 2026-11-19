# Deployment

Bei Änderungen an der Browser-PWA den vollständigen Ablauf in [docs/agent-deploy.md](docs/agent-deploy.md) ausführen: Syntax prüfen, Tests ausführen, committen, nach `origin/main` pushen und den Render-Deploy anhand von Client-Version, Health-Endpoint und Service-Worker-Cache verifizieren. Nach der Live-Verifikation einmal `scripts/notify.sh` ausführen.

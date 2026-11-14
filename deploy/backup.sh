#!/bin/sh
# Sauvegarde quotidienne : copie cohérente de la base + photos. Cron : 0 3 * * * /chemin/deploy/backup.sh
set -e
cd "$(dirname "$0")/.."
D=backups/$(date +%F); mkdir -p "$D"
sqlite3 data/samlock.db ".backup '$D/samlock.db'" 2>/dev/null || cp data/samlock.db "$D/samlock.db"
tar czf "$D/uploads.tgz" -C data uploads 2>/dev/null || true
find backups -mindepth 1 -maxdepth 1 -mtime +30 -exec rm -rf {} +   # garde 30 jours
# Copie hors serveur recommandée : rclone copy backups remote:samlock-backups

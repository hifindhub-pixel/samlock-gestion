# Mise en ligne (gratuit ou presque)

L'application = 1 processus Node + 1 fichier SQLite + un dossier de photos. Il faut donc un hébergement **avec disque persistant**.

## Options
| Option | Coût | Remarques |
|---|---|---|
| **Votre PC / mini-PC allumé en continu** + Tailscale ou Cloudflare Tunnel | 0 € | Le plus simple pour démarrer. Accès extérieur via le tunnel (liens de signature clients inclus). |
| **VM « Always Free » (ex. Oracle Cloud)** | 0 € | Disque persistant, HTTPS via Caddy. L'offre gratuite évolue : vérifier les conditions actuelles avant de s'engager. |
| Petit VPS européen | ~4–6 €/mois | Plus fiable, support, hébergement en France possible. |
| Hébergeurs « gratuits » sans disque persistant (offres de démo) | — | **À éviter** : la base serait effacée à chaque redémarrage. |

## Installation (serveur Linux avec Docker)
1. Copier le projet sur le serveur, puis : `cp deploy/.env.example .env` et remplir (`APP_URL`, `APP_PASSWORD`, `SMTP_URL`…).
2. Éditer `deploy/Caddyfile` : votre nom de domaine (enregistrement DNS A vers le serveur).
3. `docker compose up -d` → HTTPS automatique.
4. Importer vos vraies données : `docker compose exec app node server/seed.js --reset --empty` (base vide, paramètres conservés), puis renseigner **Paramètres** (raison sociale, SIRET, IBAN, assurance décennale).

## Sauvegardes
`deploy/backup.sh` (cron quotidien) copie la base et les photos et garde 30 jours. **Copiez-les aussi hors du serveur** (rclone vers un Drive, un NAS…).

## Avant d'utiliser avec de vrais clients
- Définir `APP_USER` et `APP_PASSWORD` (page de connexion, accès unique). Utiliser un mot de passe long et unique. Un seul accès : pas de comptes multiples/rôles pour l'instant.
- Configurer `SMTP_URL` : sans lui, les e-mails (dont les codes de signature) sont **simulés**.
- Remplir les mentions légales dans Paramètres et faire relire devis/factures par l'expert-comptable.
- Voir la section RGPD/hébergement : données clients = données personnelles.

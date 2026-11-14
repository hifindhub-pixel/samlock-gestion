# SAMLOCK — Logiciel de gestion (serrurerie)

Devis, interventions, facturation, stock, sous-traitants, indemnités kilométriques et envoi par e-mail au client. Base reprise du logiciel MATEBA, adaptée au métier et à la marque SAMLOCK (orange `#FF6D1A`).

## Démarrer

Prérequis : Node.js 22 ou plus récent.

```bash
npm run setup      # installe tout et charge le catalogue serrurerie + données de démonstration
npm run dev        # API sur :3001, application sur http://localhost:5173
npm run empty      # vide les données de démo avant la mise en service (les paramètres sont conservés)
npm run build:web && npm start     # production : tout sur http://localhost:3001
```

Variables d'environnement : `deploy/.env.example`. Déploiement : `DEPLOY.md`.

## Ce que fait le logiciel

| Domaine | Fonctions |
|---|---|
| Demandes → interventions | Pipeline Demande · À diagnostiquer · Devis envoyé · Devis accepté · Intervention en cours · Terminée. |
| Devis | Lignes du catalogue serrurerie, bouton **Ajouter le déplacement** (distance calculée depuis votre adresse, tranche 0-30 / 30-50 / 50-100 km), signature en ligne, TVA 10 % particulier / 20 % professionnel. |
| Facturation | Facture depuis un devis ou **facture directe** (dépannage sans devis), brouillon modifiable, n° de sinistre, mode de paiement (CB, espèces, chèque, virement), avoirs, PDF Factur-X, **envoi par e-mail au client avec le PDF joint** après aperçu et clic de validation. |
| Stock | Pièces suivies dans le catalogue : minimum / cible / emplacement, réceptions (coût moyen pondéré), casse, inventaire, quantités réservées par les devis acceptés, **sortie automatique à l'émission de la facture**, commande fournisseur préparée par e-mail (validation humaine). |
| Sous-traitants | Conformité (URSSAF + assurance RC pro) avec blocage d'affectation, ordre de mission par lien, bouton « Mission terminée », règlement (ajouté aux dépenses de l'intervention). Jamais de prix de vente visible. |
| Indemnités kilométriques | Calcul **automatique sur chaque facture émise** (adresse d'intervention ↔ adresse de départ, itinéraire routier), barème fiscal progressif sur l'année, correction manuelle, export Excel. |
| Divers | Validation humaine de tous les envois, agenda/planning, comptabilité, application installable (PWA). |

## Points à renseigner (Paramètres)
- **IBAN/BIC** et mentions d’assurance RC pro / décennale (SAS et capital 5 000 € déjà renseignés d’après les mentions légales de samlock.fr).
- **Messagerie SMTP** (sinon les envois sont simulés — l'écran d'envoi le signale).
- Véhicule (type, CV, électrique) et choix aller simple / aller-retour pour les IK.

## Services externes utilisés pour les IK
Géocodage `api-adresse.data.gouv.fr`, itinéraire OSRM public. Sans réponse du service d'itinéraire, la distance est estimée (vol d'oiseau × 1,25) et signalée « Estimation ». Surcharge possible : `IK_GEOCODER_URL`, `IK_ROUTER_URL`.

## Architecture
- `server/` : Node + Express + SQLite (un seul fichier de données à sauvegarder). `stock.js`, `ik.js`, `subs.js` : modules SAMLOCK.
- `web/` : React + Vite + Tailwind (`web/dist` est livré compilé).

## Références et stock (entrées / sorties)

- **Pièce en stock** : une seule fiche par pièce, référence interne `FAMILLE-MARQUE-MODÈLE-DIMENSION` (ex. `CYL-HER-Y7C-3030`) et **référence fournisseur** (n° chrono AFDB) dans « Réf. fournisseur ».
- **Prestation vendue** (« Fourniture et pose d'un cylindre… ») : non suivie en stock, mais liée à ses pièces dans la fiche catalogue (« Pièces consommées »). À l'émission d'une facture, les pièces sortent automatiquement ; leur coût de revient suit le coût moyen des réceptions.
- **Entrées** : page Stock (Mouvement) ou `POST /api/stock/receipts` avec `{ lines: [{ supplier_ref, qty, unit_cost }] }` (références inconnues renvoyées). **Inventaire** : mouvement « Inventaire » pour fixer la quantité réelle de départ.

### Reprise de l'historique des achats AFDB
`server/afdb-data.js` contient les achats AFDB relevés sur l'espace pro (149 commandes, 06/2025 → 11/2026, 131 références). `npm run seed` ou le bouton **Stock › Reprendre l'historique AFDB** crée les pièces absentes (réf. `FAMILLE-MARQUE-chrono`) et enregistre une entrée par référence (coût moyen pondéré). L'opération est idempotente. Le stock obtenu est un stock **théorique** (achats cumulés, sans les ventes passées) : faites un inventaire pour le corriger.

### Reprise des ventes passées (factures Tiime 1 à 433, 06/2025 → 06/2026)
`server/tiime-data.js` : sorties de pièces (145 lignes, repérées par réf. AFDB citée ou par modèle/dimension du cylindre, de la poignée Salomé, du verrou…) et dernier prix de vente HT facturé par pièce (appliqué seulement si le prix de la pièce est à 0). Environ la moitié des lignes de fourniture (articles uniques jamais rachetés) ne sont pas rattachées à une pièce du stock. Les factures n° 434 et suivantes ne sont pas incluses : les relancer après un nouvel export Tiime.

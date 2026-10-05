# Map Planner 1055 — appli desktop et PWA

Réécriture hors ligne du planificateur de territoires de rokbattles.com (Electron + React + Canvas2D).
Zones interdites pré-rendues une seule fois, index spatial pour les collisions : fluide même avec une carte complète.

## Utilisation (développeur)

    npm install
    npm run fetch-data            # télécharge règles, zones interdites, icônes (une fois)
    npm start                     # lance l'appli
    npm test                      # tests (décodeur, règles, rendu)

## Construire le .exe (sur Windows)

    npm install
    npm run dist                  # → release/ : version portable + installateur

Version portable : placez un dossier `data` à côté du .exe (ou utilisez le bouton « Télécharger les données » au premier lancement).

## Plans

Fichiers `.json` au même format que le partage du site (version 2) ; export des coordonnées en CSV (Excel) et de la carte en PNG.
Le planificateur de Baulur n'est pas inclus.

Les illustrations du jeu appartiennent à Lilith Games : usage personnel.

## Calque d'une capture d'écran (expérimental)

« Importer une capture… » dans l'éditeur :
1. Calage : cliquez un repère sur la capture, puis le même sur la carte (il s'aimante sur les structures). 4 repères minimum, bien répartis ; la capture est redressée et posée sous vos bâtiments (curseur d'opacité).
2. Détection : cliquez un contour de la couleur d'une alliance, réglez tolérance/couverture, « Détecter les contours », puis « Proposer des drapeaux ». Les drapeaux déduits sont validés par les règles de la carte (posez d'abord la forteresse de l'alliance) ; Ctrl+Z annule.

## Export d'image (bouton « Image… »)

Choix du format, de la taille et du découpage :
- **WebP sans perte** (défaut) : pixels identiques au PNG, nettement plus léger.
- **PNG** : le plus compatible, le plus lourd.
- **WebP / JPEG haute qualité** : très léger, léger lissage des textes.
- **Taille** 100 / 75 / 50 % et **découpage** 2×2, 3×3, 4×4 (fichiers `_L1_C1`…, dans un dossier au choix).
- **Poids max par fichier** : si le fichier dépasse la limite, la qualité WebP est abaissée au strict minimum nécessaire (dichotomie, qualité affichée à la fin).

## Sanctuaires (mode « Éditeur de carte »)

Bouton **Éditeur de carte** (barre du haut) : mode d'édition des données propres à la carte. Choisissez un bonus (touches 1 à 0) puis cliquez près d'un sanctuaire : la saisie se **rattache au sanctuaire le plus proche** (structure de la carte). Recliquer change le bonus, Maj+clic supprime, « Annuler » revient en arrière. Le dépliant « Structures reconnues comme sanctuaires » liste les types de structures de la carte et permet de choisir lesquels sont aimantés.
Les sanctuaires sont enregistrés avec la carte (`data/maps/<carte>/overrides.json`), donc communs à tous vos plans. Hors éditeur, ils sont affichés (et sur l'image exportée) avec leurs totaux, dont ceux situés dans le territoire de l'alliance active. Import/export Excel au format « nom du bonus / valeur du bonus / position x / position Y » (+ onglet Totaux) ; à l'import chaque ligne est rattachée à la structure la plus proche.

Icônes du jeu pour chaque bonus (carte, liste, totaux). 14 types : les 10 bonus simples (touches 1 à 0) et 4 doubles bonus (touches A, Z, E, R) : Défense + Santé 3 %/3 %, Attaque en rassemblement + Récolte 5 %/5 %, Attaque 3 % + Entraînement 10 %, Restauration de points d'action + Vitesse de soin 20 %/20 %. Les totaux sont comptés par statistique (un double bonus compte pour ses deux statistiques).

## Niveau des portes (mode « Éditeur de carte »)

« Définir le niveau des portes » : choisissez un niveau de 1 à 9 (touches 1 à 9) puis cliquez près d'une porte ; le niveau s'affiche en pastille à côté de la porte (et sur l'image exportée). Recliquer avec le même niveau ou Maj+clic le retire. Enregistré avec la carte (`overrides.json`). Le dépliant « Structures reconnues comme portes » permet de choisir les types de structures concernés.

## Règles de forteresse

Le territoire d'une forteresse (ou forteresse centrale) ne peut pas chevaucher celui d'une autre forteresse, quelle que soit l'alliance. Les territoires de drapeaux ne comptent pas : une forteresse peut les recouvrir.

## Export d'image (bouton « Image… »)

Format (WebP sans perte par défaut, PNG, WebP/JPEG haute qualité), taille 100/75/50 %, découpage 2×2 à 4×4, poids max par fichier (la qualité WebP est abaissée au strict nécessaire).

## Icônes de bonus personnalisées

Pour remplacer une icône fournie par une meilleure (ex. extraite des fichiers du jeu), déposez un PNG carré (64×64 ou plus) dans `data/icons/` sous le nom de la statistique : `harvest`, `exp`, `attack`, `rally`, `health`, `defense`, `production`, `build`, `march`, `research`, `training`, `ap`, `heal` (ex. `data/icons/harvest.png`). Elle est prise en compte à la prochaine ouverture d'une carte.

Rayon de la hit box des puits de ressource : fixé à 2,04 (plus de réglage).

## Langue
Sélecteur **Français / English** (page d'accueil, éditeur, écran de clé). Le choix est mémorisé ; par défaut la langue du système. Les textes anglais sont dans `src/core/en.ts` (la clé est le texte français) ; `npm test` vérifie qu'aucun texte n'est resté sans traduction.

## Clé d'accès (serveur)
Le serveur (`server/`, Node 20+, aucune dépendance) valide les clés, révoque, limite les appareils et ne sert `/data` qu'avec un jeton valide.

```
node server/admin.mjs add --label "Alliance X" --devices 2 --expires 2027-01-31   # affiche la clé une seule fois
node server/admin.mjs list | revoke <id> | restore <id> | reset <id> | delete <id>
PORT=8787 node server/server.mjs      # variables : DATA_DIR, WEB_DIR, KEYS_FILE, TOKEN_DAYS (30), ALLOW_ORIGIN, TRUST_PROXY=1 derrière un proxy
```
- Les clés sont stockées hachées (`server/keys.json`) ; le secret de signature est généré dans `server/secret.txt` (ou `MP_SECRET`). Sauvegardez ces deux fichiers.
- Mettez le serveur derrière HTTPS (Caddy, nginx, Cloudflare Tunnel…).
- Copiez `.env.production.example` en `.env.production` (VITE_REQUIRE_KEY=1, VITE_SERVER_URL) **avant** de compiler. Sans cela, aucune clé n'est demandée.
- Hors ligne, l'accès reste valable jusqu'à l'expiration du jeton (30 jours, renouvelé à chaque contrôle réussi, toutes les 6 h et au retour au premier plan).
- **Limite honnête** : dans l'appli Windows, les données sont sur le disque ; l'écran de clé y est un verrou d'interface, contournable par un utilisateur technique. La vraie protection est côté serveur : la version web/PWA n'obtient aucune donnée sans clé valable, et une clé révoquée est refusée immédiatement.

## Version web / tablette / smartphone (PWA)
1. `npm run build:web` → dossier `dist/`.
2. `WEB_DIR=dist DATA_DIR=data node server/server.mjs` (derrière HTTPS).
3. Ouvrir l'adresse sur la tablette/téléphone → menu du navigateur → « Installer l'application ». Fonctionne ensuite hors ligne (données mises en cache).
Tactile : un doigt déplace, deux doigts zooment ; le panneau latéral devient un tiroir (bouton ☰). Une nouvelle version publiée affiche « Nouvelle version disponible — Recharger ».

## Mises à jour de l'appli Windows (GitHub Releases)
1. Dans `package.json` → `build.publish`, remplacez `VOTRE-COMPTE-GITHUB` (et le nom du dépôt) ; créez le dépôt GitHub.
2. Augmentez `version`, puis, avec un jeton GitHub (`GH_TOKEN`, droit « repo ») : `npm run release` (construit l'installeur NSIS et publie la release).
3. Les utilisateurs installent **une fois** `Map-Planner-1055-x.y.z.exe` (installeur). Ensuite l'appli cherche, télécharge et propose « Redémarrer et installer » toute seule.
- La version *portable* et le dossier `dist:dir` ne se mettent pas à jour seuls.
- Version installée : les données et plans sont dans `%APPDATA%\Map Planner 1055\data` (épargnés par les mises à jour). Dépôt privé : l'updater a besoin d'un jeton ; préférez un dépôt public contenant seulement les releases.
- Renommer l'appli change le dossier utilisateur : les préférences (langue, mode économe) repartent de zéro.

## Tests
- `npm test` : règles, import/export, limites de taille, traductions, serveur de clés.
- `npm run e2e` : parcours complet dans un vrai navigateur (clé d'accès, langue, éditeur, tiroir mobile, révocation). Nécessite Chromium (`CHROMIUM_PATH=…` si Playwright n'en a pas installé).
- Fichiers ouverts : plans et classeurs ≤ 20 Mo, images ≤ 64 Mo ; au-delà, l'ouverture est refusée.

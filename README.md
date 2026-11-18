# Chasse aux avaloirs

Application mobile (iOS et Android) de **recensement participatif des avaloirs de voirie**, pour aider la commune à cibler les traitements larvicides contre le **moustique tigre**. Chaque relevé (photo, position au mètre près, type d'avaloir) est publié sur **OpenStreetMap** et **Panoramax**, deux communs numériques librement réutilisables dans un SIG.

![Parcours](docs/screenshots/15-reussite.jpg)

---

## Sommaire

1. [Choix techniques](#1-choix-techniques)
2. [Parcours utilisateur](#2-parcours-utilisateur)
3. [Données publiées et conformité OSM](#3-données-publiées-et-conformité-osm)
4. [Gamification](#4-gamification)
5. [Mise en service](#5-mise-en-service)
6. [Exploiter les données dans un SIG](#6-exploiter-les-données-dans-un-sig)
7. [Développement et tests](#7-développement-et-tests)
8. [Limites connues](#8-limites-connues)

---

## 1. Choix techniques

**Une application web installable (PWA)**, et non une application native :

| Besoin | Réponse |
|---|---|
| iOS **et** Android, sans passer par les stores | Une PWA s'installe depuis Safari (iPhone) ou Chrome (Android) en 3 touches : « Sur l'écran d'accueil ». Aucune validation Apple/Google, mises à jour instantanées. Sur iPhone, c'est la seule voie réaliste hors App Store. |
| Géolocalisation précise | API Geolocation en haute précision, **moyenne pondérée de plusieurs mesures** pendant 6 s, puis ajustement possible sur la **photo aérienne IGN** (20 cm/pixel). |
| Appareil photo | Viseur intégré (`getUserMedia`) avec cadre de visée, lampe, contrôle automatique de **netteté** et de **luminosité** ; repli sur l'appareil photo natif. |
| Terrain sans réseau | Fonctionne **hors ligne** (vérifié : rechargement complet sans réseau) : relevés et photos stockés sur le téléphone (IndexedDB), envoi automatique au retour du réseau. |
| Français, internationalisable | Tous les textes sont dans `src/i18n/fr.ts` et `src/i18n/en.ts` (anglais complet). Ajouter une langue = ajouter un fichier. Typographie française (espaces insécables) automatique. |

Pile : React 19 + TypeScript, Vite, Leaflet, service worker maison (sans dépendance). Fonds de carte : OSM France et orthophotos IGN (Géoplateforme). Adresses : Base Adresse Nationale (Géoplateforme IGN), Nominatim en secours.

## 2. Parcours utilisateur

1. **Photo** — « Photographiez l'avaloir » : cadre de visée, contrôle de netteté (« Photo nette » / « Photo un peu floue »).
2. **Position** — « Placez-vous au-dessus de l'avaloir » : jauge de précision GPS en direct, bouton « Je suis au-dessus », mesure moyennée sur 6 s (« Ne bougez plus… »), puis vérification sur la photo aérienne avec un repère déplaçable.
   - **Anti-doublon** : si un avaloir existe déjà dans OSM à quelques mètres, l'appli propose « C'est le même : ajouter ma photo » (l'objet existant est complété, jamais dupliqué).
3. **Type** — cartes illustrées : *Grille au sol*, *Grille et bordure*, *Bouche dans la bordure*, *Caniveau à grille*, *Autre grille / je ne sais pas*. Détails facultatifs (forme, matériau) et **observations pour la mairie** (eau stagnante visible ? avaloir obstrué ?).
   - **Caniveau à grille** : une étape supplémentaire « Tracez le caniveau » affiche la photo aérienne avec un segment à deux poignées à placer sur les extrémités de la grille, une flèche de sens d'écoulement (bouton « Inverser le sens ») et un alignement automatique sur la boussole du téléphone.
4. **Récapitulatif** — adresse, précision, score qualité détaillé, aperçu exact des tags OSM.
5. **Célébration** — points gagnés, badges, objectif du jour, puis « Relever un autre avaloir » en un geste.

Les comptes ne sont **pas** demandés au départ : on peut contribuer tout de suite, la connexion n'est proposée que pour publier.

Captures d'écran : [`docs/screenshots/`](docs/screenshots/).

## 3. Données publiées et conformité OSM

### OpenStreetMap

Schéma documenté sur le wiki OSM (vérifié en novembre 2026) : [Tag:manhole=drain](https://wiki.openstreetmap.org/wiki/Tag:manhole=drain), [Key:inlet](https://wiki.openstreetmap.org/wiki/Key:inlet) (statut *approved*), [Key:panoramax](https://wiki.openstreetmap.org/wiki/Key:panoramax), [Road inlets and covers](https://wiki.openstreetmap.org/wiki/Road_inlets_and_covers) (caniveaux à grille).

| Type présenté | Tags OSM du nœud |
|---|---|
| Grille au sol | `man_made=manhole` `manhole=drain` `inlet=grate` |
| Grille et bordure | `man_made=manhole` `manhole=drain` `inlet=kerb_grate` |
| Bouche dans la bordure | `inlet=kerb_opening` (+ `man_made=manhole` si un tampon est accolé) |
| Autre grille / je ne sais pas | `man_made=manhole` `manhole=drain` |
| Caniveau à grille | **ligne** `waterway=drainage_gutter` `covered=yes` (voir ci-dessous) |

Compléments facultatifs : `shape=rectangular|square|circular` (forme adjectivale recommandée par le wiki), `material=metal|concrete`, et `panoramax=<identifiant de la photo>`.

Règles du wiki appliquées par l'application (vérifiées par les tests automatiques) :
- `inlet=kerb_opening` ne porte **jamais** `manhole=drain` (« tagging mistake » listé par le wiki).
- Les caniveaux à grille ne portent **jamais** `manhole=drain` ni `inlet=kerb_grate` (usage explicitement déconseillé par le wiki pour les « long covered gutters »).
- Compléter un objet existant **n'écrase aucune valeur** posée par un autre contributeur : on ajoute la photo (`panoramax`, puis `panoramax:1`…), les attributs manquants et `check_date`.
- L'adresse et les observations (eau stagnante…) ne sont **pas** écrites dans OSM (hors sujet pour un nœud d'avaloir ; données temporaires).
- Groupes de modifications : `comment`, `hashtags=#avaloirs;#moustiquetigre`, `source=survey;Panoramax`, `created_by`, et `imagery_used=BD Ortho IGN` si le repère a été ajusté sur l'orthophoto.
- Publication groupée (un *changeset* par envoi, format osmChange), gestion des conflits de version et de la limitation de débit des nouveaux comptes.

> **Important — « organised editing »** : une campagne municipale relève des [lignes directrices des éditions organisées](https://wiki.openstreetmap.org/wiki/Organised_Editing_Guidelines) d'OSM. Avant le lancement, créez une page wiki décrivant la campagne (objectif, hashtags, contact) et annoncez-la sur le [forum de la communauté OSM France](https://forum.openstreetmap.fr/). Chaque participant utilise **son propre compte** OSM (c'est ce que fait l'application).

### Le cas des caniveaux à grille

**Qu'est-ce que c'est ?** Une rigole linéaire étroite (10 à 30 cm de large, d'un à plusieurs mètres de long) recouverte d'une grille continue : en travers d'une entrée de garage ou de parking, en bas d'une rampe, sur une place piétonne. Elle collecte l'eau sur toute sa longueur et la renvoie au réseau pluvial. Son fond retient souvent de l'eau et des débris : c'est un gîte larvaire potentiel au même titre qu'un avaloir.

**Comment est-ce publié ?** OSM n'a pas de page de tag *approuvée* pour cet objet. Le wiki interdit d'y mettre `manhole=drain` ou `inlet=kerb_grate`, et la clé `inlet=*` est réservée aux nœuds. La page wiki [Road inlets and covers](https://wiki.openstreetmap.org/wiki/Road_inlets_and_covers) (section « Related objects II: Drainage gutters ») propose, à l'issue d'une [discussion de la communauté en 2023](https://community.openstreetmap.org/t/tagging-of-a-steel-gutter-inlet/97424), de les tracer comme une **ligne** :

```
waterway=drainage_gutter
covered=yes            (rigole couverte d'une grille)
material=metal|concrete (facultatif)
panoramax=<photo>
```

L'application crée donc un chemin (*way*) de deux nœuds, orienté dans le sens d'écoulement indiqué par le contributeur (convention des `waterway=*` dans OSM). En novembre 2026 ce tag est utilisé environ 76 fois dans le monde : il est **proposé mais pas encore formellement documenté**. Avant un usage massif, il est recommandé de :
1. annoncer son usage sur le [forum OSM France](https://forum.openstreetmap.fr/) avec la page wiki de la campagne ;
2. si la communauté est d'accord, créer la page `Tag:waterway=drainage_gutter` sur le wiki (la page « Road inlets and covers » invite explicitement à le faire).

**Autres choix possibles** (paramètre `openstreetmap.channelDrainTagging` de `config.js`) :

| Valeur | Publication OSM |
|---|---|
| `way` (par défaut) | ligne `waterway=drainage_gutter` + `covered=yes` |
| `node` | point au centre du tracé : `inlet=grate` + `length=*` — uniquement des tags documentés, mais représentation ponctuelle d'un objet linéaire |
| `none` | rien dans OSM : photo sur Panoramax et point dans l'export pour la mairie |

Quel que soit le mode, la photo Panoramax porte `osm|waterway=drainage_gutter` et `osm|covered=yes`, et les exports SIG donnent un **point d'intervention** (centre du caniveau) avec sa longueur.

### Panoramax

Instance par défaut : **panoramax.openstreetmap.fr** (OSM France), qui se connecte **avec le compte OpenStreetMap** : un seul compte pour tout. Photos sous licence CC BY-SA 4.0, visages et plaques floutés automatiquement par le serveur.

Chaque photo porte : position et heure de prise de vue, cap (boussole), précision GPS, et des **tags sémantiques** : `osm|man_made=manhole`, `osm|inlet=…`, `hashtag=avaloirs`, et les observations `avaloirs|standing_water=yes|no`, `avaloirs|clogged=yes|no`. Les observations de terrain sont ainsi centralisées, publiques, et reliées à la photo.

## 4. Gamification

- **Points** par relevé : base 10, + qualité (0 à 10), + précision ≤ 3 m (5), + nouvel avaloir ou avaloir complété (5), + premier relevé du jour (5), + série ≥ 3 jours (5), + publication sur OSM (5).
- **Score qualité** sur 100 (précision, netteté de la photo, type identifié, détails, observations) → 1 à 3 étoiles, avec conseils pour progresser. Récompenser la *qualité* et pas seulement le volume évite les relevés bâclés.
- **10 niveaux** : Recrue, Sentinelle, Vigie, Œil de lynx, Cartographe, Pilier du quartier, Fléau des larves, Terreur du tigre, Légende de la voirie, Mythe vivant.
- **16 badges** : premier relevé, 10/50/100/500, précision, photographe, séries de 3 et 7 jours, lève-tôt, collectionneur (tous les types), explorateur (10 rues), lanceur d'alerte (eau stagnante), complétiste, publication, marathon.
- **Objectif du jour** (anneau, 5 par défaut), **série** de jours consécutifs.
- **Objectif collectif** de la commune (jauge « X / ~1 500 avaloirs ») et **classement** des contributeurs, calculés à partir des données publiques d'OSM (Overpass), sans serveur à maintenir.
- **Parrainage** : QR code « Inviter un voisin » dans les réglages.

## 5. Mise en service

### 5.1 Compiler

```bash
npm install
```

```bash
npm run build
```

Le dossier `dist/` contient l'application complète (fichiers statiques).

### 5.2 Héberger

N'importe quel hébergement statique **en HTTPS** (obligatoire pour la caméra et le GPS) : serveur de la ville, GitHub Pages, Netlify… L'application fonctionne aussi dans un sous-dossier (`https://www.ville.fr/avaloirs/`).

### 5.3 Enregistrer l'application auprès d'OpenStreetMap

1. Connectez-vous sur openstreetmap.org avec le compte de la collectivité, puis ouvrez <https://www.openstreetmap.org/oauth2/applications/new>.
2. Nom : « Chasse aux avaloirs – Ville de … ».
3. **URI de redirection** : l'adresse exacte de l'application, par ex. `https://avaloirs.ville.fr/` (avec la barre finale).
4. **Décochez** « Application confidentielle » (application mobile publique, sécurisée par PKCE).
5. Permissions : **Lire les préférences de l'utilisateur** (`read_prefs`) et **Modifier la carte** (`write_api`).
6. Copiez l'**identifiant client** dans `config.js` (`openstreetmap.clientId`).

Pour les formations, enregistrez aussi l'application sur le serveur de test <https://master.apis.dev.openstreetmap.org> (`clientIdDev`) : le « Mode test » des réglages publie alors sur ce serveur sans toucher à la vraie carte.

### 5.4 Configurer — `config.js`

Le fichier `config.js` (à la racine du site) se modifie **sans recompiler** :

| Clé | Rôle |
|---|---|
| `campaignName` | Nom affiché de la campagne. |
| `commune.insee` | Code INSEE de la commune (vide = détecté au premier relevé). |
| `commune.estimatedDrains` | Nombre estimé d'avaloirs : base de la jauge collective. |
| `dailyGoal` | Objectif quotidien individuel. |
| `openstreetmap.clientId` / `clientIdDev` | Identifiants OAuth (voir 5.3). |
| `openstreetmap.redirectUri` | Facultatif, si l'URL de retour diffère de l'adresse de l'application. |
| `openstreetmap.hashtags` | Hashtags des groupes de modifications. |
| `openstreetmap.channelDrainTagging` | Publication des caniveaux à grille : `way` (ligne, par défaut), `node` ou `none` (voir §3). |
| `panoramax.instance` | Instance Panoramax (par défaut celle d'OSM France). |
| `overpass` | Serveurs Overpass (affichage des avaloirs existants, statistiques). |

### 5.5 Tester sur un téléphone

La caméra et le GPS n'étant accessibles qu'en **HTTPS**, l'appli doit être mise en ligne avant d'être essayée sur un téléphone :

- **GitHub Pages** (recommandé, adresse stable) : créer un dépôt public, y envoyer ce projet, puis dans *Settings › Pages › Build and deployment*, choisir la source **GitHub Actions**. Le fichier `.github/workflows/deploy-pages.yml` compile, teste et publie l'appli à chaque envoi sur `main`, à l'adresse `https://<compte>.github.io/<dépôt>/`.
- **Dépôt rapide** : glisser le contenu du dossier `dist/` sur un hébergement statique HTTPS (Netlify Drop, serveur de la ville…).

Sur Android, ouvrir l'adresse dans **Chrome** : l'appli propose alors « Installer ». Sans identifiant OAuth dans `config.js`, tout fonctionne (photo, GPS, type, tracé, points) sauf la publication : les relevés restent « En attente » sur le téléphone.

### 5.6 Diffuser

- Affiche ou flyer avec un **QR code** vers l'adresse de l'application (généré dans Réglages › Inviter un voisin).
- À la première ouverture, l'application explique comment l'ajouter à l'écran d'accueil (instructions iPhone, bouton « Installer » sur Android).

## 6. Exploiter les données dans un SIG

- **Dans l'application** : Réglages › Données › « Couche SIG de la commune (OSM) » télécharge un GeoJSON de tous les avaloirs de la commune présents dans OSM, avec le lien vers leur photo. Les relevés personnels s'exportent en GeoJSON ou CSV (séparateur `;`, compatible Excel).
- **Dans QGIS** : extension *QuickOSM*, ou requête Overpass :

```
[out:json][timeout:60];
area["ref:INSEE"="69387"]["boundary"="administrative"]->.a;
(
  node["manhole"="drain"](area.a);
  node["inlet"~"^(grate|kerb_grate|kerb_opening)$"](area.a);
  way["waterway"="drainage_gutter"](area.a);
);
out meta center;
```

- **Observations (eau stagnante…)** : API Panoramax de l'instance, recherche des photos portant `hashtag=avaloirs` et lecture de leurs `semantics`.

## 7. Développement et tests

```bash
npm run dev
```

```bash
npm test
```

```bash
npm run build && npm run e2e
```

- `npm test` : 34 tests unitaires (schéma OSM dont les trois modes des caniveaux, construction des osmChange nœuds et chemins, PKCE, moyenne GPS et géométrie, points/badges, complétude des traductions).
- `npm run e2e` : parcours complet sur iPhone émulé (Playwright), avec une fausse caméra qui filme une grille d'avaloir et des serveurs OSM/Panoramax simulés : 31 contrôles (OAuth PKCE, envoi Panoramax, tags OSM créés et complétés, tracé d'un caniveau et création du chemin OSM, aucune erreur JavaScript). Les captures d'écran de `docs/screenshots/` en sont issues.
- `npm run icons` : régénère les icônes depuis `public/icons/favicon.svg`.

Structure : `src/lib/` (métier : `taxonomy.ts`, `osm.ts`, `panoramax.ts`, `sync.ts`, `gamification.ts`, `geo.ts`…), `src/screens/` (écrans), `src/components/` (composants d'interface), `src/i18n/` (traductions).

## 8. Limites connues

- **Précision GPS** : un smartphone grand public donne 3 à 5 m dans de bonnes conditions ; la moyenne et l'ajustement sur orthophoto permettent d'atteindre le mètre. Les rues étroites bordées d'immeubles dégradent la précision : l'application l'affiche et le score qualité en tient compte.
- **iPhone** : l'application doit être installée depuis **Safari**. Si, après la connexion OpenStreetMap, le retour s'ouvre hors de l'application installée, un écran affiche un code à coller dans Réglages (procédure de secours prévue).
- **Nouveaux comptes OSM** : OpenStreetMap limite le nombre de modifications par heure des comptes récents ; l'application réessaie automatiquement.
- **Classement** : basé sur le dernier contributeur de chaque objet dans OSM (pas de serveur dédié).
- **Caniveaux à grille** : le schéma `waterway=drainage_gutter` est proposé par la communauté mais pas encore formalisé (voir §3). Le sens d'écoulement repose sur l'appréciation du contributeur ; un caniveau de plus de 30 m doit être relevé en plusieurs tronçons.
- Les données restent sur le téléphone tant qu'elles ne sont pas publiées : l'application demande au navigateur de ne pas les effacer, mais il est conseillé de se connecter rapidement.

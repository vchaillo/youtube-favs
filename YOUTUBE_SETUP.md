# Connecter youtube-favs à Cloudflare Workers

Le site reste sur **GitHub Pages**. Firebase **Spark** conserve la connexion Google et les bibliothèques personnelles. Le **Worker Cloudflare** interroge YouTube et garde la clé API côté serveur. Cette configuration n'utilise pas Firebase Functions, Secret Manager ou le forfait Blaze.

## 1. Activer l'API YouTube et créer une clé serveur

1. Ouvrir [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com?project=yt-favs-b05e1). Vérifier que le projet est **yt-favs-b05e1**, puis cliquer sur **Activer** si nécessaire.
2. Ouvrir [API et services → Identifiants](https://console.cloud.google.com/apis/credentials?project=yt-favs-b05e1), puis **Créer des identifiants → Clé API**.
3. Nommer la clé `youtube-favs-cloudflare` et restreindre les **API autorisées** à **YouTube Data API v3**.
4. Laisser les **restrictions d'application** sur **Aucune** pour ce Worker, qui n'a pas d'IP de sortie fixe. Une restriction par référent de site web ne convient pas à ces appels serveur. Ne pas réutiliser la clé Web Firebase.
5. Garder la clé pour l'étape 3. Ne pas la mettre dans un fichier du dépôt, dans le frontend ou dans une discussion.

## 2. Créer le Worker depuis GitHub — méthode recommandée

Dans le même compte Cloudflare que MovieQuest :

1. Ouvrir [Cloudflare](https://dash.cloudflare.com/) → **Workers & Pages**.
2. Choisir **Create application / Créer une application**, puis **Import a repository / Importer un dépôt** ou l'option de connexion à GitHub. Choisir un **Worker**, pas un site Pages.
3. Autoriser le dépôt **vchaillo/youtube-favs** si Cloudflare ne le propose pas, puis le sélectionner.
4. Renseigner :

| Champ | Valeur |
| --- | --- |
| Nom du Worker | `youtube-favs` |
| Branche de production | `main` |
| Root directory / Dossier racine | `worker` |
| Build command / Commande de build | Laisser vide |
| Deploy command / Commande de déploiement | `npm run deploy` |

Le dossier `worker` possède son propre `package.json` et son fichier `wrangler.toml`. Cloudflare installe ses dépendances et Wrangler prépare automatiquement le code. Aucun dossier de sortie n'est nécessaire. Le nom choisi doit correspondre à `name = "youtube-favs"` dans `worker/wrangler.toml`.

5. Cliquer sur **Deploy / Déployer** et attendre la fin du déploiement.
6. Copier l'URL publique du Worker, par exemple `https://youtube-favs.votre-compte.workers.dev`.

Le frontend préremplit `https://youtube-favs.valentinchaillou89.workers.dev` en reprenant le sous-domaine configuré pour MovieQuest. Il s'agit d'une adresse attendue, pas d'une preuve que le nouveau Worker existe. Utiliser l'URL réellement affichée par Cloudflare.

## 3. Ajouter le secret YouTube au Worker

1. Ouvrir le Worker **youtube-favs** dans Cloudflare.
2. Aller dans **Settings → Variables and Secrets**.
3. Cliquer sur **Add**, choisir le type **Secret** et saisir exactement :

| Champ | Valeur |
| --- | --- |
| Nom | `YOUTUBE_API_KEY` |
| Valeur | La clé YouTube créée à l'étape 1 |

4. Enregistrer et déployer la modification (**Deploy** ou **Save and deploy**, selon l'interface).

Attention : il faut un **secret d'exécution du Worker**, dans **Settings → Variables and Secrets**. Les secrets de **Build** sont distincts et ne seront pas disponibles quand le site appelle l'API. Les secrets restent côté Cloudflare ; `keep_vars = true` préserve les variables configurées dans le tableau de bord.

Aucun secret Firebase, fichier de compte de service, jeton OAuth YouTube ou abonnement Workers Paid n'est nécessaire pour cette configuration.

## 4. Vérifier le Worker

Ouvrir `https://VOTRE-WORKER.workers.dev/health` dans le navigateur.

Le résultat attendu est :

```json
{
  "ok": true,
  "service": "youtube-favs",
  "projectId": "yt-favs-b05e1",
  "youtubeConfigured": true,
  "rateLimitConfigured": true
}
```

- `youtubeConfigured: false` : ajouter le secret d'exécution `YOUTUBE_API_KEY` puis déployer.
- `rateLimitConfigured: false` : vérifier que le déploiement utilise bien `worker/wrangler.toml`, avec ses deux liaisons de limitation.
- Une réponse 404 : vérifier l'URL exacte et le déploiement du Worker.

Ce contrôle vérifie la configuration déclarée, pas la validité de la clé chez Google. Le test réel est l'actualisation d'une émission à l'étape suivante.

## 5. Relier le site au Worker

1. Ouvrir [youtube-favs](https://vchaillo.github.io/youtube-favs/) et se connecter avec Google.
2. Ouvrir **Mon profil** depuis l'avatar en haut à droite.
3. Dans **Connexion YouTube**, coller l'URL publique du Worker, sans `/health`, `/api/youtube`, paramètres ou clé.
4. Cliquer sur **Tester et enregistrer**. Le site vérifie `/health` avant d'enregistrer l'adresse dans ce navigateur.
5. Ouvrir **Papy Grenier** et cliquer sur **Importer depuis YouTube**. Une prévisualisation affiche les vidéos trouvées : cocher les vidéos souhaitées puis confirmer avec **Importer la sélection**. Aucun ajout n’est effectué avant cette confirmation.
6. Tester **Rhinocéros** et **Esquive la Boule de Feu**. Dans la prévisualisation, utiliser **Charger la suite** pour parcourir les archives jusqu'au message **Dernière page atteinte**.

La connexion Google et les règles [firestore.rules](firestore.rules) existantes restent nécessaires. Si la bibliothèque fonctionne déjà, aucune modification Firebase n'est requise. L'URL du Worker est une configuration locale publique ; suivis, favoris et épisodes vus restent sauvegardés dans le compte Firebase.

## Autre méthode : déployer depuis son ordinateur

Avec Node.js 22 ou une version compatible avec Wrangler, depuis un clone à jour du dépôt :

```sh
cd worker
npm ci
npx wrangler login
npm run deploy
npx wrangler secret put YOUTUBE_API_KEY
```

La dernière commande demande la clé de manière interactive et publie une nouvelle version avec ce secret. Ouvrir ensuite `/health` et suivre l'étape 5. Ne pas lancer `firebase init` ou `firebase deploy` pour ce backend.

## Fonctionnement et limites

- Firebase Authentication identifie l'utilisateur. Le frontend transmet son jeton d'identité, et le Worker vérifie sa signature RSA avec les clés publiques Google, son expiration, son émetteur et le projet `yt-favs-b05e1`. Aucun jeton n'est enregistré dans le stockage de l'application. La vérification ne consulte pas les révocations de session en temps réel ; un jeton déjà émis peut rester valide jusqu'à son expiration.
- La clé YouTube n'est jamais renvoyée au frontend. La route `POST /api/youtube` exige une session valide. CORS accepte seulement `https://vchaillo.github.io` ; CORS ne remplace pas la vérification du jeton.
- `action: "catalog"` accepte une playlist, une chaîne complète ou une sélection par mots-clés ; `action: "videos"` accepte jusqu'à 50 identifiants pour recharger les métadonnées. Les sources sont limitées à YouTube : aucune URL de destination arbitraire n'est acceptée par le proxy.
- Sources de chaîne : `/@identifiant`, `/channel/UC…` et `/user/…`. Une page analyse au maximum 50 publications. Les mots-clés séparés par des virgules sont comparés au titre et à la description, sans distinction d'accents ou de majuscules.
- La récupération est déclenchée à la demande, sans GitHub Action de catalogue ni tâche Firebase planifiée. La recherche globale YouTube n'est pas encore une interface de cette version ; le champ de recherche existant filtre le catalogue déjà importé. Les nouvelles sources peuvent être ajoutées par leur lien dans « Suivre une émission ».
- Les limites natives Cloudflare sont de 30 demandes/minute/compte et 60 pages non mises en cache/minute pour l'application, **par emplacement Cloudflare**. Elles sont approximatives et ne constituent pas un compteur mondial strict ni un budget journalier. Le quota Google Cloud reste la limite globale de l'API YouTube. Les namespaces de ces deux bindings sont propres à youtube-favs.
- Cache en mémoire : 15 minutes, 128 pages maximum par instance. Il peut disparaître au redémarrage ou différer entre instances. Les métadonnées API ne sont pas copiées dans Firestore ; seuls les identifiants et les choix personnels sont sauvegardés. Le catalogue historique fourni dans le dépôt reste un relevé statique distinct.
- Limite actuelle : 1 000 ajouts et retraits personnels par compte, en plus du catalogue initial. Une vidéo reste rattachée à une seule émission. L'import est additif et ne supprime pas les anciens ajouts lorsque les règles changent.
- Les vidéos privées, supprimées ou absentes de la source peuvent manquer. La lecture, les publicités et les restrictions régionales ou d'intégration restent contrôlées par YouTube.
- Utiliser Workers **Free** et Firebase **Spark** dans leurs quotas. Le quota Workers gratuit est partagé avec les autres Workers du compte, dont MovieQuest. Vérifier les quotas Google Cloud et Cloudflare selon l'utilisation.

## Validation

Depuis la racine :

```sh
npm ci --ignore-scripts
npm ci --prefix worker
npm test
npm run check --prefix worker
npm run test:rules
```

Le contrôle Wrangler est un assemblage local à blanc : il ne déploie rien et n'utilise pas de clé YouTube. Les tests vérifient l'API HTTP, les signatures RSA, le refus des sessions invalides, la pagination, le filtrage, les limites, les changements de compte et la configuration du frontend. Le test réel avec la clé YouTube se fait après déploiement du Worker.

Documentation : [secrets Workers](https://developers.cloudflare.com/workers/configuration/secrets/), [déploiement depuis Git](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [limites natives](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [vérification Firebase](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [API YouTube](https://developers.google.com/youtube/v3/getting-started).


## Prévisualisation et retrait de vidéos

L’enregistrement d’une nouvelle émission ouvre automatiquement la prévisualisation YouTube. Pour une émission existante, **Importer depuis YouTube** relance la lecture de sa source pour trouver d’éventuelles nouveautés. Les résultats se parcourent par pages, avec miniatures, titres, dates et durées ; les vidéos déjà présentes sont signalées et ne créent pas de doublons. Les choix de cases à cocher sont conservés lors du chargement des pages suivantes.

**Importer la sélection** ajoute uniquement les vidéos choisies. Fermer la prévisualisation n’ajoute aucune vidéo. Le bouton **Retirer** dans la prévisualisation, ou la croix sur une carte, retire une vidéo de la bibliothèque de ce compte, y compris une vidéo du catalogue initial. Elle reste retirée après rechargement et n’est pas sélectionnée automatiquement à l’import suivant. Une sélection explicite permet de la réimporter. Le catalogue des autres utilisateurs reste intact.

Les retraits sont stockés comme références privées marquées dans le document existant : aucune nouvelle collection ni modification des règles Firestore n’est nécessaire.

## Dépanner une erreur de clé YouTube

L’ancien message « La clé ou l’activation de YouTube Data API doit être vérifiée côté serveur » regroupait plusieurs erreurs Google. Mettre le Worker à jour depuis la branche `main` pour obtenir le motif précis. `/health` doit annoncer la version `2026-10-21-import-preview` ; ce contrôle seul ne vérifie pas la validité de la clé chez Google.

Dans **Mon profil**, **Tester l’accès à YouTube** effectue une véritable lecture de vidéo publique avec la clé conservée dans le Worker. Le résultat permet de distinguer :

| Motif | Vérification |
| --- | --- |
| `SERVICE_DISABLED` / `accessNotConfigured` | Activer YouTube Data API v3 dans le projet **auquel appartient la clé**, puis attendre quelques minutes si l’activation est récente. |
| `API_KEY_SERVICE_BLOCKED` | Autoriser YouTube Data API v3 dans les restrictions relatives aux API de la clé. |
| `API_KEY_HTTP_REFERRER_BLOCKED` / `ipRefererBlocked` | Une restriction « Sites Web » bloque les appels serveur ; utiliser la clé serveur dédiée, sans cette restriction d’application. |
| `API_KEY_IP_ADDRESS_BLOCKED` | Une restriction d’adresse IP ne correspond pas à la sortie réseau Cloudflare. |
| `API_KEY_INVALID` / `keyInvalid` | Remplacer le secret `YOUTUBE_API_KEY` par la clé complète, sans guillemets, puis déployer la modification Cloudflare. |
| `forbidden` | Vérifier les restrictions de la clé et le caractère public de la source. Ce motif seul ne prouve pas que la clé est invalide. |

Le projet de la clé YouTube peut être distinct du projet Firebase : c’est le projet de la **clé YouTube** qui doit avoir l’API activée. Ne jamais envoyer la clé dans une discussion pour diagnostiquer le problème. Les messages affichent uniquement des motifs reconnus ; aucune URL Google brute ni valeur de secret n’est exposée.

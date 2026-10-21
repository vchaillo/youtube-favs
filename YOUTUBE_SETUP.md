# Activer la récupération YouTube

Le frontend est sur https://vchaillo.github.io/youtube-favs/. La fonction callable `youtubeCatalog` est préparée pour le projet Firebase **yt-favs-b05e1**, région **europe-west1**. Le frontend appelle automatiquement cette fonction ; aucune URL à saisir et aucune clé YouTube dans le navigateur.

## Configuration à faire une seule fois

1. Dans [Google Cloud](https://console.cloud.google.com/apis/library/youtube.googleapis.com?project=yt-favs-b05e1), activer **YouTube Data API v3** sur le même projet.
2. Dans [Identifiants](https://console.cloud.google.com/apis/credentials?project=yt-favs-b05e1), créer une **nouvelle clé API serveur** et limiter ses restrictions d’API à **YouTube Data API v3**. Ne pas réutiliser la clé Web Firebase. Une restriction de référent HTTP ne convient pas aux appels serveur. Si une restriction IP est souhaitée, il faut configurer une sortie réseau à IP fixe séparément.
3. Le déploiement Cloud Functions nécessite le forfait Firebase **Blaze** et un compte de facturation. Vérifier les coûts et configurer une alerte de budget. Les limites applicatives ci-dessous protègent le quota YouTube, elles ne constituent pas un plafond de facturation Firebase.
4. Depuis la racine du dépôt, avec Node.js 22 :

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix functions --ignore-scripts --no-audit --no-fund
npx firebase login
npx firebase functions:secrets:set YOUTUBE_API_KEY --project yt-favs-b05e1
npx firebase deploy --only functions:youtubeCatalog --project yt-favs-b05e1
```

La commande `functions:secrets:set` demande la clé de manière interactive et l’enregistre dans Google Secret Manager. Ne pas la mettre dans GitHub, le JavaScript public ou un message de discussion. Les droits Google Cloud requis peuvent être demandés par le CLI au premier déploiement.

Les règles [firestore.rules](firestore.rules) doivent déjà être publiées pour accéder à la bibliothèque personnelle. Les compteurs serveur sont sous `_youtubeLimits` : les clients n’y ont aucun accès avec ces règles. La fonction utilise les droits administrateur de son compte de service.

Facultatif : activer une règle de suppression TTL sur le champ `expiresAt` du groupe de collections `_youtubeLimits` dans Firestore pour supprimer les anciens compteurs. Leur date d’expiration est fixée à deux jours. Leur contenu ne comprend ni clé ni métadonnées de vidéos.

## Vérification après déploiement

- Se connecter à l’application avec Google et ouvrir **Papy Grenier**.
- Cliquer sur **Actualiser depuis YouTube** : titres, dates et durées sont rechargés depuis la playlist officielle.
- Tester **Rhinocéros**, puis **Esquive la Boule de Feu**. **Charger la suite** parcourt les archives, 50 publications par page. Le message « Dernière page atteinte » indique une pagination terminée, pas une garantie que toutes les vidéos historiques sont encore publiques.
- Pour une règle par mots-clés, vérifier les correspondances sur plusieurs pages, y compris les pages sans résultat. Au moins un terme séparé par une virgule doit apparaître dans le titre ou la description ; les accents et les majuscules sont ignorés.
- Recharger la page : les références des ajouts personnels restent dans le compte et leurs métadonnées sont relues depuis YouTube. Vérifier que les suivis, favoris et épisodes vus restent propres à chaque compte.
- Se déconnecter : aucun import n’est possible. Une réponse tardive est ignorée si le compte change.

## Fonctionnement et limites

- Authentification Firebase obligatoire : le SDK callable transmet le jeton et Firebase le vérifie. Aucune permission OAuth YouTube n’est demandée pour ces données publiques. L’application ne lit pas les abonnements, playlists privées ou « J’aime » personnels du compte Google.
- Sources prises en charge : playlists `?list=…`, chaînes `/@identifiant`, `/channel/UC…` et anciens liens `/user/…`. Remplacer un ancien lien `/c/…` par son handle actuel.
- Une requête lit une page de 50 publications au maximum. Les vidéos privées ou supprimées ne sont pas importées. Les vidéos non intégrables conservent le lien vers YouTube.
- Les chaînes sont lues via leur playlist de publications ; pas de `search.list` coûteux. Une page réserve jusqu’à 3 unités d’appels de lecture ; un lot de métadonnées en réserve 1. Le budget applicatif global est de 4 000 unités/jour UTC, en plus du quota Google Cloud réel.
- Chaque compte est limité à 30 requêtes/minute et 300/jour UTC, y compris les réponses en cache. Les compteurs et le budget global sont mis à jour dans une transaction Firestore, donc partagés entre les instances.
- Cache en mémoire serveur : 15 minutes, 128 pages maximum par instance. Les métadonnées API restent dans la mémoire de l’onglet et ne sont pas copiées dans Firestore. Seuls les identifiants, leur rattachement à une émission et les choix personnels sont sauvegardés. Le catalogue historique fourni dans le dépôt reste un relevé statique distinct.
- Limite actuelle : 1 000 ajouts personnels par compte, en plus des vidéos du catalogue initial. Une vidéo est rattachée à une seule émission dans le modèle actuel. L’import est additif : changer une règle ne supprime pas les anciennes références.
- Les nouvelles sorties sont récupérées au clic sur **Actualiser**, pas via une tâche planifiée. Une playlist peut être ordonnée manuellement ; parcourir toutes ses pages pour vérifier l’ensemble de ses ajouts.
- Deux instances serveur maximum, aucune instance minimale. Aucun téléchargement de vidéo ni contournement des restrictions de lecture.

## Validation locale

```sh
npm test
npm run test:rules
```

Les tests d’API utilisent des réponses Google simulées pour vérifier pagination, sélection, cache, quotas, erreurs et absence de fuite de clé. Les règles Firestore sont testées dans un émulateur. Le test avec une véritable clé YouTube et un compte Google doit être effectué après activation ; un test simulé ne prouve pas la configuration du projet de production.

Documentation : [YouTube Data API](https://developers.google.com/youtube/v3/getting-started), [fonctions callable](https://firebase.google.com/docs/functions/callable), [secrets Firebase](https://firebase.google.com/docs/functions/config-env), [déploiement Functions](https://firebase.google.com/docs/functions/get-started).

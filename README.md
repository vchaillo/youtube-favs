# YouTube Data API — Cloudflare Worker

Le frontend utilise désormais un Worker Cloudflare pour récupérer les vidéos à la demande. Firebase Spark conserve la connexion Google et les données personnelles. Aucun déploiement Firebase Functions ni forfait Blaze n’est nécessaire. Le [guide de configuration](YOUTUBE_SETUP.md) explique comment déployer le dossier `worker`, ajouter le secret `YOUTUBE_API_KEY` et renseigner l’URL dans Mon profil.

# youtube-favs

A personal YouTube show library: follow specific programs instead of entire channels.

## Features

- Dark interface inspired by Movie Quest, red accent, responsive gallery and list views.
- A one-time public catalogue import covering five selections and 189 real videos.
- Imported publication timestamps and durations, original video titles, source links and channel identity verification.
- Show details, title search, category and watched-state filters, sorting and browser back/forward navigation.
- Favorites, watchlist and manual watched status saved privately in Firestore.
- Embedded YouTube player loaded only after an explicit click, plus a permanent YouTube fallback link.
- Add shows with channel/keyword or playlist rules; manually add videos by URL.
- Light/dark themes and accent preferences.
- Google sign-in, account photo and per-user Firestore state.
- No forced follows: Explorer contains the shared catalogue; My follows and the episode feed contain only the signed-in user’s selections.
- Explicit legacy-demo import into the selected Google account.
- Transactional delta updates preserve independent edits made on different devices.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. No build step is required for the frontend. Firebase SDK modules are imported from the official Google CDN; development dependencies are used only for validation and the security emulator. The production Firebase Web configuration is in `firebase-app.mjs`.

## GitHub Pages

Select **GitHub Actions** as the publishing source in **Settings → Pages**. The included workflow validates the application, packages the static files including `data/`, and deploys each push to `main`.
All application URLs are relative and navigation uses hashes, so project Pages subpaths and page refreshes work without rewrite rules.
Expected project URL: https://vchaillo.github.io/youtube-favs/

## Firebase setup and private data

Read [FIREBASE_SETUP.md](FIREBASE_SETUP.md) and publish [firestore.rules](firestore.rules) before using the cloud library.

Firebase Authentication handles Google sign-in. Each account stores its private selections, custom records and preferences in the exact document `users/{uid}/app/state`. The rules grant access only to that UID, validate the schema and require monotonically increasing revisions and server timestamps. All other paths and collection queries are denied.

The public catalogue stays in `data/catalog.js`; it is not copied into each account. Custom channel/show rules and manually added episodes are account-private. New users start with no follows, favorites or watched state. Catalogue updates never automatically subscribe a user.

Firestore uses an in-memory cache. No new application state is written to localStorage, and no local-only fallback is enabled on cloud failure. The Authentication SDK can retain its sign-in session in browser storage. The old unowned demo key `youtube-favs:v1` is read only to offer an explicit profile import. That key is removed only after a confirmed successful import into the selected account. Failed or cancelled imports preserve it.

Account transitions unsubscribe listeners, cancel queued writes and clear the previous account’s application state and player immediately. Write callbacks capture their original UID and document path; they never retarget a different account. Transactions merge list additions/removals and custom-record changes rather than overwriting the entire remote state with a stale snapshot. Permission and network failures show an explicit retry screen.

Resetting the library clears only the signed-in account’s selections, custom records and preferences. It does not delete the shared catalogue or the Google/Firebase account.

The YouTube Data API and its private-key backend remain a separate integration. No YouTube API key is included in this repository.

## Imported catalogue — 20 October 2026

| Selection | Imported videos | Source and coverage |
| --- | ---: | --- |
| Papy Grenier | 20 | Complete visible official playlist, including both Cyberpunk 2077 versions. |
| Rhinocéros | 72 | Complete visible official Blast playlist. Videos omitted by the publisher from that playlist are not guaranteed. |
| Esquive la Boule de Feu | 74 | Channel uploads, cross-checked against the channel Videos tab. One old offline live-stream slot without a replay was excluded. |
| _Underscore | 11 | ALT 236's official playlist: 10 ARTE episodes and one ALT 236 trailer. |
| Rétro F1 | 12 | Official CANAL+ Sport annual retrospectives, 2013–2025 except 2021. |
| **Total** | **189** | No duplicate video identifiers. |

`data/catalog.js` bundles the snapshot, import timestamp, source URLs, channel IDs, per-selection coverage notes and the excluded offline live-stream entry. Every included video has a publication timestamp and duration, obtained from public watch-page metadata. All Rétro F1 entries were checked against the official CANAL+ Sport channel ID. Third-party playlist references were used only to locate some early official video URLs; unofficial reuploads and unrelated videos were excluded.

The 2021 Rétro F1 edition, *Révolution*, was not located on the official YouTube channel. Its official CANAL+ reference is linked from the show page. The twelve referenced YouTube videos may have geographic restrictions; metadata access does not imply that the embedded player will work in every country.

This is an import snapshot, not an ongoing sync. The bundled snapshot remains available while authenticated, on-demand requests through the Cloudflare Worker refresh the catalogue. Private rules and references are saved in Firestore. Private, deleted or otherwise inaccessible content cannot be guaranteed. No audiovisual content was downloaded or rehosted.

Thumbnail requests go to `i.ytimg.com`. The YouTube iframe is created only when the user chooses to load it, using `youtube-nocookie.com`; this still connects to YouTube. Playback, ads, regional restrictions and embedding permissions remain controlled by YouTube. Watched status is manual.

## Validation

```sh
node --check app.js
node --check data/catalog.js
node --check cloud-state.js
node --check firebase-app.mjs
npm ci --ignore-scripts
npm test
npm run test:rules
```

Tests cover catalogue navigation, user-specific filtering, account changes, explicit legacy import, URL validation, manual records, deferred player loading, concurrent saves, stale callbacks and cloud failures. Firestore emulator tests prove owner-only reads/writes, rejection of anonymous and cross-account requests, validation and revision checks. They do not complete a real Google sign-in, verify live Firestore rules or replace visual browser QA. Emulator commands always use the isolated demo project `demo-youtube-favs`.

## YouTube integration

The Worker imports playlist pages, resolves channel uploads and filters titles and descriptions by normalized keywords. The frontend allows personal rules, manual additions, authenticated import previews with per-video selection, archive pagination and private video removals. Search currently filters the imported catalogue; global YouTube search remains a future feature. API metadata stays in tab/server memory, while Firestore stores personal selections and video references.

See [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md) for deployment, limits and current coverage. GitHub Pages deploys only public frontend assets; Worker source and development files are excluded from the Pages artifact.

## Catalogue sources

- Papy Grenier: https://www.youtube.com/playlist?list=PLGbut4pdSxUOiO5bOUryKgE9jtVUlgFz4
- Rhinocéros: https://www.youtube.com/playlist?list=PLv1KZC6gJTFkFmZmlejLN6qyV7gvcmXwd
- Esquive la Boule de Feu: https://www.youtube.com/@EsquivelaBouledeFeu
- Esquive channel uploads: https://www.youtube.com/playlist?list=UUYPwq5uafGQrr4PW8GQRxew
- _Underscore: https://www.youtube.com/playlist?list=PLx7YW4P5M1C94xA7VXd8YGnDbeZDX4Xki
- CANAL+ Sport: https://www.youtube.com/@CanalplusSport
- Missing 2021 edition reference: https://www.canalplus.com/sport/formule-1/2021/

## API documentation

- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/docs/playlistItems/list
- https://developers.google.com/youtube/iframe_api_reference

# youtube-favs

A personal YouTube show library: follow specific programs instead of entire channels.

## Prototype features

- Dark interface inspired by Movie Quest, red accent, responsive gallery and list views.
- A one-time public catalogue import covering five selections and 189 real videos.
- Imported publication timestamps and durations, original video titles, source links and channel identity verification.
- Show details, title search, category and watched-state filters, sorting and browser back/forward navigation.
- Favorites, watchlist, manual watched status and local persistence.
- Embedded YouTube player loaded only after an explicit click, plus a permanent YouTube fallback link.
- Add shows with channel/keyword or playlist rules; manually add videos by URL.
- Light/dark themes and accent preferences.
- Automatic local-state migration: retain favorites, watched state, watchlists, custom shows and existing follow choices when the bundled catalogue changes.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. No build step, dependencies or API key are required.

## GitHub Pages

Select **GitHub Actions** as the publishing source in **Settings → Pages**. The included workflow validates the application, packages the static files including `data/`, and deploys each push to `main`.
All application URLs are relative and navigation uses hashes, so project Pages subpaths and page refreshes work without rewrite rules.
Expected project URL: https://vchaillo.github.io/youtube-favs/

## Data and limitations

This version does not authenticate users or contact the YouTube Data API. `localStorage` holds only this browser's preferences and selections, under `youtube-favs:v1`; the reset action affects that key only. Clearing browser data removes the prototype state. Other devices do not share it.

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

This is an import snapshot, not an ongoing sync. The application performs no YouTube Data API calls. It stores following rules locally for a later integration. Private, deleted or otherwise inaccessible content cannot be guaranteed. No audiovisual content was downloaded or rehosted.

Thumbnail requests go to `i.ytimg.com`. The YouTube iframe is created only when the user chooses to load it, using `youtube-nocookie.com`; this still connects to YouTube. Playback, ads, regional restrictions and embedding permissions remain controlled by YouTube. Watched status is manual.

## Validation

```sh
node --check app.js
node --check data/catalog.js
node --test tests/app.test.cjs
```

Tests cover catalogue integrity, routing, filters, persistence, legacy-state migration, URL validation, manual show creation and deferred player loading. They do not verify actual YouTube playback or replace visual browser QA.

## Next integration

1. Prefer official show playlists and paginate `playlistItems.list` to import archives.
2. Otherwise list a channel's uploads and apply normalized title/description matching within that channel, with manual exceptions.
3. Maintain a shared public catalogue using a scheduled GitHub Action and a YouTube API key stored as an Actions secret. Cache metadata and respect API quotas and refresh policies. Scheduled Actions are not exact-time delivery.
4. Add Firebase Authentication and per-user Firestore collections for followed shows, favorites, watched IDs and watchlists. Use security rules tied to the authenticated UID.
5. Use a server or Worker for private, dynamic per-user YouTube catalogue requests when necessary; never put a server API secret in frontend files.

Firebase is a separate concern from YouTube metadata ingestion. GitHub Pages is static hosting and cannot run a persistent backend.

## Catalogue sources

- Papy Grenier: https://www.youtube.com/playlist?list=PLGbut4pdSxUOiO5bOUryKgE9jtVUlgFz4
- Rhinocéros: https://www.youtube.com/playlist?list=PLv1KZC6gJTFkFmZmlejLN6qyV7gvcmXwd
- Esquive la Boule de Feu: https://www.youtube.com/@EsquivelaBouledeFeu
- Esquive channel uploads: https://www.youtube.com/playlist?list=UUYPwq5uafGQrr4PW8GQRxew
- _Underscore: https://www.youtube.com/playlist?list=PLx7YW4P5M1C94xA7VXd8YGnDbeZDX4Xki
- CANAL+ Sport: https://www.youtube.com/@CanalplusSport
- Missing 2021 edition reference: https://www.canalplus.com/sport/formule-1/2021/

## API documentation for the next stage

- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/docs/playlistItems/list
- https://developers.google.com/youtube/iframe_api_reference

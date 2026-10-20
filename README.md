# youtube-favs

A personal YouTube show library: follow specific programs instead of entire channels.

## Prototype features

- Dark interface inspired by Movie Quest, red accent, responsive gallery and list views.
- Papy Grenier (Joueur du Grenier) and Rhinocéros (Blast), with a small curated sample of real videos.
- Show details, title search, category and watched-state filters, sorting and browser back/forward navigation.
- Favorites, watchlist, manual watched status and local persistence.
- Embedded YouTube player loaded only after an explicit click, plus a permanent YouTube fallback link.
- Add shows with channel/keyword or playlist rules; manually add videos by URL.
- A clearly labeled new-release simulation, light/dark themes and accent preferences.

## Run locally

Serve this directory with any static HTTP server, for example:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. No build step, dependencies or API key are required.

## GitHub Pages

Publish the `main` branch, repository root (`/`), in **Settings → Pages**.
All application URLs are relative and navigation uses hashes, so project Pages subpaths and page refreshes work without rewrite rules.
Expected project URL: https://vchaillo.github.io/youtube-favs/

## Data and limitations

This version does not authenticate users or contact the YouTube Data API. `localStorage` holds only this browser's preferences and selections, under `youtube-favs:v1`; the reset action affects that key only. Clearing browser data removes the prototype state. Other devices do not share it.

The initial catalogue is partial. Seed video identifiers were checked against public references; availability and embedding permission can change. Thumbnail requests go to `i.ytimg.com`. The YouTube iframe is created only when the user chooses to load it, using `youtube-nocookie.com`; this still connects to YouTube. Playback, ads, regional restrictions and embedding permissions remain controlled by YouTube. Watched status is manual.

Following rules are stored only. They do not fetch video metadata or detect releases yet. The simulation adds one previously selected real Rhinocéros video, with an abbreviated display title; it does not mean that a new video has just been published.

## Next integration

1. Prefer official show playlists and paginate `playlistItems.list` to import archives.
2. Otherwise list a channel's uploads and apply normalized title/description matching within that channel, with manual exceptions.
3. Maintain a shared public catalogue using a scheduled GitHub Action and a YouTube API key stored as an Actions secret. Cache metadata and respect API quotas and refresh policies. Scheduled Actions are not exact-time delivery.
4. Add Firebase Authentication and per-user Firestore collections for followed shows, favorites, watched IDs and watchlists. Use security rules tied to the authenticated UID.
5. Use a server or Worker for private, dynamic per-user YouTube catalogue requests when necessary; never put a server API secret in frontend files.

Firebase is a separate concern from YouTube metadata ingestion. GitHub Pages is static hosting and cannot run a persistent backend.

## Seed references

- https://www.youtube.com/watch?v=V34x1CxlAZ0 — Papy Grenier, Mass Effect
- https://www.youtube.com/watch?v=MatN8AsTDCs — Papy Grenier, Cyberpunk 2077
- https://www.youtube.com/watch?v=VXycYC2xqrE — Rhinocéros
- https://www.youtube.com/watch?v=IL-4u-jeJJQ — Rhinocéros, simulation sample
- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/docs/playlistItems/list
- https://developers.google.com/youtube/iframe_api_reference

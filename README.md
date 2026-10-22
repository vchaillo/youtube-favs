# youtube-favs

A private YouTube programme library hosted on GitHub Pages, with Firebase Google sign-in / Firestore and an authenticated Cloudflare Worker for YouTube Data API access.

## Experience

- New accounts start empty. Imported programmes are automatically followed; there is no separate follow toggle or favorites feature.
- One library with Channels, Programmes and Episodes views. A channel groups its imported programmes.
- Import by playlist URL, full channel, or programme name within a channel. A single channel field suggests known channels and searches YouTube after a 650 ms typing pause. Selecting a result fills its canonical URL. Programme imports use the programme name as their title/description filter.
- Delete a programme and its imported episodes with a confirmation, including programmes with no episodes. Mark every visible (non-deleted) imported episode of one programme watched in one cloud write, independently of search filters.
- Keyed DOM updates preserve episode cards and thumbnail elements when watched flags or Firestore snapshots change; the watchlist removes only the watched cards.
- Whole-channel imports preview only one page of 50 uploads by default. Continue with the next 50 or explicitly scan every remaining page; no videos are saved until selection confirmation.
- Import previews exclude videos of three minutes or less by default. This duration filter is labelled as Shorts and short videos because public API metadata cannot reliably distinguish actual Shorts. The per-programme inclusion choice is saved with its source and reused for new-release checks.
- A profile display preference hides/reveals these short videos throughout the library and To Watch without deleting records. It is saved per account in this browser, not synchronized through Firestore. Missing durations remain visible rather than guessed.
- Keyword archive scans continue automatically through pages of 50 uploads and pause after five consecutive pages without matches. The next page token is retained for manual continuation; scans can also be paused.
- Preview video selections before import, with global and per-video watched choices. Programme covers use imported video thumbnails.
- Opening To Watch checks every imported source for new publications. Newly discovered releases and the unseen backlog appear in separate sections. Marking a release watched clears its novelty flag; removed videos are not automatically restored.
- Programmes have multiple editable categories, shown as colored labels on programme, channel and episode cards. The Notion-style selector supports existing labels, Enter to create, removal, keyboard navigation and empty selections. Legacy single categories migrate into a label array; the first label is retained in the legacy field for compatibility. The shared category/search/sort toolbar applies to library and To Watch channel, programme and episode views. To Watch grouping includes only unseen episodes; switching its views does not retrigger the source scan.
- Programme appearance can be edited from the detail cover or category badge. Categories, thumbnail IDs and user-provided HTTPS image URLs are stored privately in the existing programme record. Automatic covers update to the most recent imported publication; manual covers remain unchanged until the user switches back to automatic mode.
- Episode modals immediately load the YouTube player. Watched status is controlled by an accessible check icon. Playback restrictions remain controlled by YouTube.

## Setup

- [Cloudflare and YouTube setup](YOUTUBE_SETUP.md)
- [Firebase setup and account isolation](FIREBASE_SETUP.md)

The Worker remains on Workers Free and Firebase on Spark within their respective quotas. The YouTube API key belongs only in the Cloudflare runtime secret `YOUTUBE_API_KEY`.

The Worker version for this experience is `2026-10-21-library`. Its new channel-name lookup and chronological page metadata require redeploying the Worker from the current `main` branch.

## Data and migration

Each account uses its existing private `users/{uid}/app/state` document. Previously imported custom programmes and legacy explicitly followed programmes remain available. The bundled `data/catalog.js` is used only to hydrate those legacy selections; it is not shown to new users. Former favorites are no longer displayed. Existing Firestore rules remain compatible; there are no new top-level fields.

Programme records store source references, a cover video ID, optional channel ID and new-release watermark. Video references store watched choices, private removal flags and optional novelty flags. API titles, durations and publication metadata are kept in tab/Worker memory rather than copied into Firestore.

Current limits remain 200 programmes and 1,000 personal video references/removals in one state document. One video ID belongs to one programme. Larger libraries will require separate collections. New-release discovery uses the publication timestamp: late additions of historical videos are available through manual import rather than being labelled new releases. Playlists are traversed fully because their order can be arbitrary; chronological channel uploads stop at the stored watermark. Failed source checks leave their watermark unchanged. Checks run while the site is open, not as background notifications.

Frontend YouTube calls are serialized and spaced by 2.2 seconds. Native Worker rate limits and Google quotas still apply, including usage from other tabs/devices. Metadata reloads can take some time for large libraries.

## Validation

```sh
npm ci --ignore-scripts
npm ci --prefix worker
npm test
npm run test:rules
npm run check --prefix worker
```

Tests cover migration, empty new accounts, private source grouping, imports and watched choices, five-page stopping/resume, source lookup, new-release checks, exclusions, account changes, real RSA signature verification and Firestore owner isolation. Wrangler validates packaging without publishing. Live Google sign-in, production API credentials and player behavior require checking in the deployed application.

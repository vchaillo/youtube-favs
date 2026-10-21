# Firebase production setup

Project: `yt-favs-b05e1`  
Site: https://vchaillo.github.io/youtube-favs/

## Required console action

Open [Firestore → Rules](https://console.firebase.google.com/project/yt-favs-b05e1/firestore/rules), replace the editor contents with the complete [firestore.rules](firestore.rules) file, then choose **Publish**.

The Web configuration does not grant administrative permission to publish rules. Publishing the website does not deploy Firestore rules. The repository’s emulator tests validate the supplied file in a local demo project, not the rules currently deployed to production.

Keep **Google** enabled under Authentication → Sign-in method. The authorized domains must include `vchaillo.github.io`, without a scheme, path or trailing slash. The public Auth configuration was checked during integration and already included this domain.

No account password, Firebase Admin private key or service-account JSON is required for the browser integration. The Firebase Web API key is public configuration; access to private documents is enforced by the published rules.

## Data model

The only client-writable document is:

```text
users/{authenticated UID}/app/state
```

It contains imported programmes and video references, watched state, private removal / new-release flags, source watermarks, view/theme/accent preferences, a schema version, a transaction revision and a server update timestamp. The former following/favorites/queue top-level fields are retained for schema compatibility; the library no longer exposes separate following or favorites controls. API metadata remains in memory. Existing rules are compatible.

Owners can read and modify their own state. Anonymous clients, other UIDs, other paths and collection-wide queries are denied. Lists have size limits; private custom records are sanitized before being displayed. The current state document is designed for a modest personal library. Split it into collections before reaching Firestore’s document-size limit.

## First real-account check

1. Open the site and sign in with Google.
2. A new account has an empty library. Use **Suivre une émission** to preview and import its videos.
3. Choose watched/unwatched state during import, open an episode and change a preference.
4. Reload or sign in on another device: the same account must recover its choices.
5. Sign out and use a different Google account: the first account’s choices must not appear.
6. If the old local demo is available, its import appears under **Mon profil**. Confirm the displayed destination account before importing. This action is never automatic.

If Google rejects the domain, review the authorized domains. If Firestore rejects access, first publish the exact rules file above. The app intentionally offers no browser-only fallback after a cloud error.

## Local validation

```sh
npm ci --ignore-scripts
npm test
npm run test:rules
```

The pinned emulator CLI supports Java 17 or newer. The tests use `demo-youtube-favs` and cannot write to the production project. They exercise anonymous access, cross-account reads/writes/deletes, invalid schemas, unexpected fields, server timestamps and transaction revision checks.

## Separate YouTube API step

YouTube requests go through the authenticated Cloudflare Worker. See [YOUTUBE_SETUP.md](YOUTUBE_SETUP.md). The bundled catalogue only preserves legacy imported selections and is not injected into new accounts. Keep the YouTube API key in Cloudflare runtime secrets.

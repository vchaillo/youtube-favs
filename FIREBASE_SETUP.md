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

It contains selected show IDs, favorite/watched/watchlist video IDs, custom shows, manually added videos, view/theme/accent preferences, a schema version, a transaction revision and a server update timestamp. Shared video metadata remains in the public bundled catalogue.

Owners can read and modify their own state. Anonymous clients, other UIDs, other paths and collection-wide queries are denied. Lists have size limits; private custom records are sanitized before being displayed. The current state document is designed for a modest personal library. Split it into collections before reaching Firestore’s document-size limit.

## First real-account check

1. Open the site and sign in with Google.
2. A new account has no follows. Choose a show or a full channel from **Explorer**.
3. Add a favorite, mark an episode as watched and change a preference.
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

Google sign-in and Firestore do not fetch new YouTube uploads. The 189-video catalogue remains a one-time import. A backend hosting choice and a separate YouTube Data API key are still needed for the planned authenticated proxy. Do not put that backend key in the frontend or this repository.

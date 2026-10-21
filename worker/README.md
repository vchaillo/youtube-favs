# youtube-favs Worker

Authenticated YouTube metadata proxy for the GitHub Pages frontend. Firebase ID tokens are verified using Google's public RSA keys. The only runtime secret is `YOUTUBE_API_KEY`.

See the complete French setup guide in [YOUTUBE_SETUP.md](../YOUTUBE_SETUP.md), including Cloudflare Git integration, runtime secrets, health checks and frontend configuration.

```sh
npm ci
npx wrangler login
npm run deploy
npx wrangler secret put YOUTUBE_API_KEY
```

Deploy using the included `wrangler.toml`; both native rate-limiter bindings are mandatory. `GET /health` is public and reports configuration booleans only. `POST /api/youtube` requires `Authorization: Bearer <Firebase ID token>` and accepts the existing `catalog` and `videos` actions. Responses are never browser-cached.

`npm run check` assembles the Worker without publishing it. No Node server, Firebase Admin credentials, Blaze plan or private database access is needed. Keep API keys out of source files, logs, build variables and frontend bundles.

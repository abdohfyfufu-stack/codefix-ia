# CodeFix AI

## Run locally

```sh
npm install
npm start
```

The Express server serves the HTML pages and the `/api` endpoints. Code tasks
use Gemini 2.5 Flash through `GEMINI_API_KEY`, which must be configured in the
server environment; it is never stored in browser settings. Without the key,
AI requests return an explicit configuration error.

Projects, AI history, and non-secret settings are stored in a local JSON file
under the operating system temporary directory by default. This is suitable
for local development, but data is not guaranteed to survive restarts or
deployment instance replacement. Set `CODEFIX_DATA_DIR` to a persistent,
private directory (for example, a mounted persistent disk) when deploying.
Guest sessions are isolated by an HttpOnly browser cookie. Login, GitHub
OAuth/import, paid subscriptions, and multi-user authentication are not
configured; project data is not an authenticated account or a backup.
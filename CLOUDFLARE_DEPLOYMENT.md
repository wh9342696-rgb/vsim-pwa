# Cloudflare deployment

The static customer and admin PWAs are in `frontend/` and can be deployed as one Cloudflare Pages project.

## Pages settings

- Framework preset: None
- Build command: leave empty
- Build output directory: `frontend`
- Production URL: serve the customer app at `/` and admin at `/admin`

`frontend/_redirects` maps `/admin` and `/admin/` to `admin.html`.

## API options

The PWAs use same-origin `/api/v1` by default in production. Configure a Cloudflare Worker, Pages Function, or reverse proxy so `/api/*` forwards to the Node API. Keep the browser URL and API URL on HTTPS.

For a separately hosted API, set this before `js/api.js` and `js/admin-api.js` load, or put the value in both HTML `vsim-api-base` meta tags. The API URL must use HTTPS in production:

```html
<meta name="vsim-api-base" content="https://api.example.com/api/v1">
```

The value must include `/api/v1` and must not end with `/`.

## Backend

Run the Node server separately on a host that supports Node.js and PostgreSQL. Set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET`, and `NODE_ENV=production`. Allow the Pages origin in the API CORS policy and expose HTTPS endpoints for `/api/v1` and `/api/v1/realtime`.

## PWA cache

The service workers cache static shell assets and bypass API requests. Cloudflare must not permanently cache `service-worker.js`, either manifest, or API responses. The included `_headers` file marks these assets as revalidation-sensitive.

After deployment, open `/` and `/admin`, install each PWA, then confirm that login, live data refresh, notifications, payments, and realtime updates reach the production API.

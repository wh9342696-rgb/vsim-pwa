# VSIM PWA Deployment

This folder is a complete static build containing both applications:

- User PWA: `/` or `/index.html`
- Admin PWA: `/admin` or `/admin.html`
- API origin: `https://api.vsime.uk`

## Cloudflare Pages

1. Create a GitHub repository containing the contents of this `frontend` folder.
2. Create a Cloudflare Pages project connected to that repository.
3. Use the repository root as the project root.
4. Leave the build command empty.
5. Leave the build output directory as the project root (`/`).
6. Attach the production domain serving the PWA over HTTPS.

The `_redirects` and `_headers` files are already included for Cloudflare Pages. The PWA uses same-folder user/admin assets and the API URL is configured in both HTML entrypoints.

## Required DNS/API setup

The production API must remain reachable at `https://api.vsime.uk`. The backend CORS configuration must allow the exact frontend origin, such as `https://vsime.uk`, with no wildcard origin.

If the frontend domain changes, update these values in both `index.html` and `admin.html` only when the API origin changes. Do not add database credentials, JWT secrets, bridge secrets, or `.env` files to this repository.

## Security notes

- HTTPS is required for API calls, passkeys, and service workers.
- User and admin JWTs are stored separately in browser storage and are sent only to the configured HTTPS API.
- API requests are excluded from service-worker caching.
- Service-worker cache versions are bumped when static assets change.
- Admin access requires a real password; no default password is shipped in the page.
- Cloudflare Pages should use the production branch only after reviewing the repository contents for secrets.

## Local preview

Serve this folder with any static HTTPS-capable server. Opening the HTML files directly is not a valid PWA test because service workers require HTTPS or localhost.

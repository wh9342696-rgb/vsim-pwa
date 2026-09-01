Steps to point `admin.vsime.uk` to the admin static app and backend

1) Cloudflare DNS
   - Add an A record:
     - Name: `admin`
     - Type: `A`
     - Content: <Your VPS IPv4>
     - Proxy status: "Proxied" (orange) or "DNS only" (grey) depending on TLS choice

2) TLS on Cloudflare
   - If you want Cloudflare to proxy (orange cloud):
     - Set SSL/TLS -> Overview to `Full (strict)`.
     - Install a valid origin certificate on your VPS (Let's Encrypt or Cloudflare Origin CA).
   - If you set Cloudflare to `Flexible`, disable origin HTTP->HTTPS redirects on VPS to avoid loops.

3) Nginx (on your VPS)
   - Create `/etc/nginx/sites-available/admin.vsime.uk.conf` with the provided config.
   - Symlink to `/etc/nginx/sites-enabled/` and `nginx -t` then `systemctl reload nginx`.
   - Ensure `root` points to the built frontend folder containing `admin.html` and assets.

4) Backend connectivity
   - Ensure `api.vsime.uk` DNS points to the same VPS IP (or your API server IP).
   - Backend env `FRONTEND_URL` should include `https://admin.vsime.uk` if admin fetches directly.
   - Ensure CORS allows `https://admin.vsime.uk` (check `server.js` uses `process.env.FRONTEND_URL`).

5) SPA fallback
   - The nginx `try_files` directive ensures deep links load `admin.html`.

6) Troubleshooting
   - If you see "too many redirects", check Cloudflare SSL mode and VPS redirect rules.
   - For testing, set Cloudflare DNS to `DNS only` (grey) and browse to `https://admin.vsime.uk` to isolate Cloudflare.

7) Optional
   - Use Cloudflare Pages to host static assets and set a CNAME for `admin` to the Pages subdomain.

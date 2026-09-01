# Copilot Instructions for vsim-pwa

Purpose
- Provide concise, repeatable agent instructions for working on this repository.
- Apply to all contributions unless a file-specific exception is noted.

Scope
- Repository root and all subfolders. Note: the frontend is hosted on Cloudflare (static assets deployed from `frontend` and `admin`).

Agent Rules (required)
1. Always use the managed todo list for multi-step work (track with `/memories/` tool). Keep items small and mark progress.
2. Never request or accept passwords in chat. Use SSH key authentication for server access.
3. When referring to files or paths in the repo, use repository links in reports and include exact relative paths.
4. Be concise and direct in developer-facing messages; avoid unnecessary user-facing verbosity.
5. Do not volunteer model details or internal meta info unless explicitly asked.
6. For server work, prefer Node 22 runtime (where applicable) and use `npm ci` in `frontend/server` to install dependencies.
7. Treat `frontend` and `admin` as Cloudflare-deployed static sites — do not change deployment-specific headers/redirects or Cloudflare config without testing.

Backend / VPS Access
- Preferred access: add a temporary public key to `root` (or to an ephemeral sudo user). The agent will never accept private keys or passwords via chat.
- Backend path: `frontend/server`.
- Typical commands to run (on the server):

```bash
cd ~/vsim-pwa/frontend/server
git pull
node -v
npm -v
npm ci
npm run dev
# or for production
npm run start:prod
```

Logging & Debugging
- Capture logs with `tail -n 200 server_dev.log` (if run redirected) or `sudo journalctl -u <service> -n 200` for systemd services.
- Report `node -v` and `npm -v` before installing; if `npm` is missing, prefer installing Node via `nvm` or official NodeSource setup for the required major version.

Cloudflare Notes
- Frontend is served via Cloudflare; static assets, manifest and service worker are in `frontend/` and `admin/`.
- Deploy changes to Cloudflare only after local build verification. Keep `manifest.json`, `_headers`, and `_redirects` intact unless you understand their Cloudflare implications.

Communication Preferences
- Use short progress updates after completing 3–5 terminal actions or after editing multiple files.
- When asking for clarification, keep questions targeted and list only the exact info needed.

Examples (prompts to test behavior)
- "Update the backend `package.json` in `frontend/server` to bump `zod` to ^4.0.0; run tests locally and report failures."
- "Pull latest on VPS, run `npm ci` and start dev server; return `node -v`, `npm -v`, process list, and last 200 log lines."

Next steps
- Confirm this instruction file is acceptable or specify any additional rules you want enforced (e.g., linting, testing, CI hooks, code style).
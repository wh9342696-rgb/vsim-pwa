# VSIM PWA Repository Structure

## Overview
This repository contains the VSIM Progressive Web App (PWA) frontend and admin panel. The backend API is separate and runs at `https://api.vsime.uk`.

## Directory Structure

```
esim/
├── frontend/              # Main customer-facing PWA app
│   ├── index.html         # Main app entry point
│   ├── admin.html         # Admin page (legacy, use admin/ instead)
│   ├── js/                # JavaScript files
│   │   ├── app.js         # Main app logic
│   │   ├── api.js         # API client for customer app
│   │   ├── admin-api.js   # Admin API wrapper
│   │   └── admin.js       # Admin functionality
│   ├── css/               # Stylesheets
│   │   ├── app.css        # App styles
│   │   └── admin.css      # Admin styles
│   ├── manifest.json      # PWA manifest for main app
│   ├── service-worker.js  # Service worker for offline support
│   └── icons/             # App icons and assets
│
├── admin/                 # Admin panel (standalone PWA)
│   ├── index.html         # Admin login and panel
│   ├── js/
│   │   ├── admin-api.js   # Admin API client
│   │   └── admin.js       # Admin UI logic
│   ├── css/
│   │   └── admin.css      # Admin styling
│   ├── manifest.json      # PWA manifest
│   └── service-worker.js  # Service worker
│
└── README.md              # Project documentation
```

## API Configuration

Both frontend and admin are configured to connect to the backend at:
```
https://api.vsime.uk/api/v1
```

### Frontend API (`frontend/js/api.js`)
- **Base URL**: `https://api.vsime.uk/api/v1`
- **Routes**: `/auth`, `/esims`, `/wallet`, `/airtime`, `/referrals`, etc.

### Admin API (`admin/js/admin-api.js`)
- **Base URL**: `https://api.vsime.uk/api/v1/admin`
- **Routes**: `/login`, `/logout`, `/me`, `/merchants`, `/users`, etc.

## Deployment

### Frontend
- **URL**: https://vsime.uk
- **Entry Point**: `frontend/index.html`
- **Served by**: Express backend or static hosting

### Admin Panel
- **URL**: https://vsime.uk/admin
- **Entry Point**: `admin/index.html`
- **Credentials**: admin@vsim.com / admin123 (configured in HTML)

## Development

### Running Locally
```bash
# Install dependencies (if needed)
npm install

# Serve frontend
npm start

# The frontend will be available at http://localhost:3000
# Admin panel at http://localhost:3000/admin
```

### Making Changes
1. Edit files in `frontend/` for customer app
2. Edit files in `admin/` for admin panel
3. Ensure API base URLs point to correct backend
4. Test in browser and PWA mode
5. Commit changes with clear messages
6. Push to GitHub

## Security Notes

- Admin credentials are visible in `admin/index.html` (default values only)
- JWT tokens are stored in localStorage
- API requires Bearer token authentication
- CORS is restricted to the frontend domain
- All communication is HTTPS only in production

## Backend Integration

The backend API server runs separately at:
- **API Domain**: https://api.vsime.uk
- **Backend Code**: Hosted on VPS (Vultr)
- **Database**: PostgreSQL
- **Server**: Node.js + Express

See the main backend repository for server-side code.

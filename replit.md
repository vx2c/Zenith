# Zenith

Zenith is a Roblox Studio AI companion web app. It lets Roblox developers connect their Roblox account via OAuth and access an AI-powered dashboard for scripting, debugging, and workflow automation inside Roblox Studio.

## Architecture

- **Frontend**: React + Vite app at `artifacts/zenith/` — serves the landing page and dashboard
- **API Server**: Express 5 at `artifacts/api-server/` — handles the Roblox OAuth token exchange
- **Shared libs**: `lib/api-spec/` (OpenAPI), `lib/api-client-react/` (generated hooks), `lib/api-zod/` (Zod schemas)

## Roblox OAuth

The app uses Roblox OAuth 2.0 (openid + profile scopes).

- Public CLIENT_ID `4229742603179424213` is hardcoded in the frontend (safe — it's a public identifier)
- `ROBLOX_CLIENT_ID` and `ROBLOX_CLIENT_SECRET` must be set as Replit Secrets for the API server to exchange codes for tokens
- OAuth redirect URI: `<origin>/roblox-callback`

## Key routes

- `/` — Landing page (unauthenticated) or Dashboard (authenticated via localStorage `roblox_user_name`)
- `/roblox-callback` — OAuth callback handler page
- `/api/roblox-callback` (POST) — Token exchange endpoint in the API server

## Running

Workflows are managed by Replit:
- `artifacts/zenith: web` — Vite dev server (frontend)
- `artifacts/api-server: API Server` — Express backend

## User preferences

- Preserve original Zenith monochrome palette: `#111111` primary, `#f6f6f6` background, frosted-glass cards

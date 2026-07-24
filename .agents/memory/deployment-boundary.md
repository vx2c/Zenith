---
name: Deployment boundary
description: The imported project contains separate Vercel serverless code and Replit artifact code; changes must target the deployment that actually serves xzenith.vercel.app.
---

Vercel production serves the repository-root static frontend and `api/*.js` serverless functions through `vercel.json`; the `artifacts/` API and Zenith apps are a separate Replit runtime and are not automatically the production path.

**Why:** The imported project contains two implementations with overlapping chat/plugin functionality, so editing the Replit artifact alone can leave the published site unchanged.

**How to apply:** Before implementing a production fix, confirm the requested behavior against the root `index.html`/`script.js`, root `api/` handlers, and the Vercel rewrites. Treat the artifact apps as local Replit runtimes unless deployment configuration explicitly changes.
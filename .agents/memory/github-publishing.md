---
name: GitHub publishing
description: Reliable way to publish changes when the repository remote uses HTTPS.
---

When the local `git push` to an HTTPS GitHub remote fails for missing or invalid credentials, use Replit's authorized GitHub push helper rather than handling a token manually.

**Why:** The workspace may have a valid GitHub account connection even when the shell has no usable HTTPS credential helper.

**How to apply:** Commit locally, verify the branch and remote, then call the authorized GitHub push operation for the target branch and confirm the remote commit.
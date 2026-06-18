# Env files (optimizer-tools repo)

| File | In repo | Purpose |
|------|---------|---------|
| `ci.env.example` | yes | Checklist for CircleCI Docker Hub push |
| `ci.env.enc` | yes | RoRo-encrypted CI creds; decrypted in CircleCI only |
| `ci.env` | no (gitignored) | Ephemeral; created by `roro generate:exposed ci` in CI |
| `production.env` | **no** | Lives in **clickholes** — see below |

**Running audits (GSC, Cloudflare, live SEO):** use the clickholes Compose service, which
mounts `clickholes/mise/containers/optimizer-tools/env/production.env` and
`config/sites.json`.

This repo builds and publishes the `handsomefencer/optimizer-tools` image only.

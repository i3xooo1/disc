# Railway deployment

The app includes a production Docker image and `railway.json`. They compile the TypeScript, run the compiled server with production dependencies, listen on Railway's assigned `PORT` on `0.0.0.0`, use `/api/health` for readiness, and request one replica. The image runs as the unprivileged `node` user.

These files prepare deployment; they do not create a Railway project, allocate a volume, or publish the service.

## Service configuration

1. Create a Railway project/service for this checkout. Deploy the source using the Railway plugin or a connected repository. The Dockerfile is the build entry point. Keep the image's default start command: `node dist/src/server.js`.
2. **Attach a persistent Railway volume at `/data` before deploying.** This stores dashboard keys, sessions, and logs. Do not use an ephemeral filesystem for the database. The image sets `DATA_DIR=/data`, `HOST=0.0.0.0`, and `TRUST_PROXY=1`. Ensure the mounted volume permits the `node` user (UID/GID 1000) to create its per-guild directory. If startup reports a permissions error, correct the mounted volume ownership; do not make it world-writable.
3. Generate a public Railway domain. The app derives its HTTPS origin from `RAILWAY_PUBLIC_DOMAIN`. For a custom domain, set `PUBLIC_ORIGIN=https://your-domain.example` exactly, without a trailing slash. An explicit `PUBLIC_ORIGIN` overrides Railway's automatic domain.
4. Provide the following service variables through Railway's secure variable settings:

| Variable | Live service value |
| --- | --- |
| `DEMO_MODE` | `false` |
| `DISCORD_TOKEN` | Your actual Discord bot token; keep it secret |
| `DISCORD_GUILD_ID` | Your default Discord server ID; keep the existing value to preserve dashboard keys |

Railway supplies `PORT`; don't replace it with a fixed port. Keep one replica and one volume per service. Disable sleeping/serverless operation: the Discord bot needs a continuously running outbound WebSocket connection. Use Railway's HTTPS ingress for the dashboard; do not add another public TCP endpoint.

The bot requires Server Members Intent and the Discord permissions/role order documented in [README.md](README.md). Live startup fails clearly if the token, guild ID, or Discord connection is unusable. A successful `/api/health` response in live mode means the service reached startup after connecting to Discord, but does not prove each moderation permission works.

Invite this same bot to any additional Discord servers. Owner keys can select all connected servers from the sidebar; reload the dashboard after inviting the bot. Staff keys are limited to the server selected when they were generated, and existing staff keys retain access to the default server. Each server has its own warnings, logs, reset previews, and jobs under `/data/live-<server-id>/`. Dashboard authentication stays in the default server's database. No extra service or token is needed.

## First dashboard sign-in

To provision the first owner key without SSH, generate a random 32-byte key locally with the `disc_` prefix and base64url encoding. Keep the raw key in a password manager and set only its lowercase SHA-256 hash as `BOOTSTRAP_OWNER_KEY_SHA256` in Railway. On startup the app creates an owner entry only if no active owner already exists; it never replaces existing keys or logs the raw key. Keep this hash private and remove the variable after the first successful sign-in. If an owner already exists, use that owner's key.

Alternatively, after deployment, open a Railway shell/SSH session **in the running service with its volume mounted** and run:

```sh
node dist/scripts/create-key.js "Server owner"
```

Copy the displayed owner key directly to a password manager, then sign in at the Railway dashboard domain. Select the intended server and generate staff keys under **Access keys**. Anyone with a valid key can moderate and reset servers that key can access.

With an authenticated Railway CLI, `railway ssh` can open the running service's shell. `railway run` launches locally and does **not** write to the deployed volume; don't use it to bootstrap the deployed dashboard. Owner keys are never generated at every deployment or printed in normal application startup logs.

The volume persists through redeploys; your access keys and audit logs should remain. Back it up using your Railway volume/backup process. Reset jobs interrupted during redeployment are not automatically resumed. Existing remote requests may complete during a hard shutdown.

## Optional demo deployment

For an initial UI deployment before configuring Discord, set `DEMO_MODE=true`, attach the volume, and omit the Discord credentials. Generate the owner key in the running service as above. Demo mode never contacts Discord. Later, set `DEMO_MODE=false`, supply the Discord credentials, redeploy, and generate a separate live owner key. Demo and live keys use different directories.

## Validation

Check Railway build/deployment logs, confirm the health check reports the intended mode, then sign in and verify the member and channel lists. In live mode, use a harmless warning on a test member to verify dashboard access and logging; verify destructive behavior in the isolated demo, not by resetting the live server. Confirm volume persistence with a redeploy before relying on the service.

Locally, `npm run build:production` validates the same compile step used by the Docker build. Automated tests cover derived Railway HTTPS origins, authentication, reset semantics, and the browser flows. Docker image and remote Railway validation still require a functioning Docker builder and authorized Railway access.

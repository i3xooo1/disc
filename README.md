# Disc Control

A private website dashboard for a Discord moderation bot. Built with Node.js 24+, TypeScript, Express, discord.js, and SQLite. No external database or Discord OAuth login is required.

## What it does

- Member directory, warnings and warning history, timeouts and timeout removal, kicks, bans, and unbans by Discord user ID.
- Message cleanup in text channels (1–100 messages; Discord skips messages older than 14 days).
- Channel and role directory, current timeouts, recent moderation activity, and an audit trail attributed to each access key.
- Owner-generated, expiring staff keys. Revoking a key immediately invalidates its active sessions.
- A server selector for every server the connected bot belongs to, with separate warnings, activity logs, reset previews, and reset jobs.
- A reset workflow to ban eligible members, delete eligible roles, and delete eligible channels. Select any combination, review the actual target list, and confirm with the exact server name and `RESET SERVER`.
- Reset progress, individual operation results, partial failure reporting, and interrupted-job detection after a restart.
- A responsive dashboard and a demo that never contacts Discord.

**Every valid dashboard key grants full moderation and reset access within its assigned servers.** Owner keys can switch between all connected servers and alone can generate and revoke staff keys. A staff key grants access only to the server selected when it was generated. Existing staff keys remain assigned to the configured default server. A key is a bearer credential: the label records which key acted, not proof of a Discord member’s identity. Share one key per trusted person, privately. The website is the command interface; no Discord slash commands are registered.

## Try the demo

From the existing checkout:

```sh
cd /workspace/disc
npm ci --cache /tmp/disc-npm-cache
```

If you do not already have a `.env`, create it from `.env.example`. Its default is demo mode:

```sh
cp .env.example .env
npm run key:create -- "Server owner"
npm start
```

The key command displays the owner key once in your terminal. Save it in a password manager. Open the dashboard on port 3000 and sign in with that key. Use **Access keys → Generate key** to invite staff.

If using environment variables instead of a `.env`, set `DEMO_MODE=true` for both commands:

```sh
DEMO_MODE=true npm run key:create -- "Server owner"
DEMO_MODE=true npm start
```

Both fake servers reset to their starting members/channels whenever the demo process restarts. Demo keys and logs persist separately from live-server data.

## Connect your Discord server

1. Create an application at [Discord Developer Portal](https://discord.com/developers/applications). Under **Bot**, create/reset its token and enable **Server Members Intent**. This intent is needed to list and reset members. The bot does not require Message Content or Presence intents.
2. Under **OAuth2 → URL Generator**, select the `bot` scope and these permissions: **View Channels, Read Message History, Manage Messages, Kick Members, Ban Members, Manage Channels, Manage Roles, Moderate Members**. The permissions integer is `1099780138006`. Invite the bot to your server.
3. In Discord server settings, move the bot’s role above the members and roles you want it to moderate. Review channel permission overrides as well.
4. Enable Discord Developer Mode, right-click your server, and copy its server ID.
5. Stop the demo. Update your local `.env` or your hosting platform’s secure environment settings:

```dotenv
DEMO_MODE=false
DISCORD_TOKEN=your_bot_token
DISCORD_GUILD_ID=your_server_id
HOST=127.0.0.1
PORT=3000
PUBLIC_ORIGIN=http://localhost:3000
TRUST_PROXY=0
```

Never commit your token or share it in chat. `.env` and `.data` are ignored by Git. In cloud environment settings, provide `DISCORD_TOKEN` as a confidential runtime environment value: the Discord bot needs the actual value for its gateway connection, not a destination-bound proxy placeholder.

6. Generate a **live owner key** and start the service:

```sh
npm run key:create -- "Server owner"
npm start
```

Demo and live keys are isolated. `DISCORD_GUILD_ID` identifies the default server and the database that stores dashboard authentication; keep it unchanged to preserve existing keys. Invite the same bot to additional servers and reload the dashboard to see them in the server selector. No extra bot token or Railway service is required. Owner keys cover all connected servers; create a staff key while its intended server is selected.

Warnings are stored in this dashboard’s database and do not send a DM. Bans do not erase message history. Unbanning does not automatically rejoin the member.

## Reset behavior

Anyone with a valid staff or owner key can preview and execute reset in a server they can access. A preview lasts five minutes, belongs to the server and key that created it, and is single-use. Switching servers discards the displayed preview. Creating a preview does not mutate Discord. Confirmation requires the exact server name and `RESET SERVER`.

Execution bans members first, deletes roles second, and deletes channels last, with channel categories last. It operates sequentially through discord.js, which handles Discord API rate limits. Only IDs from the preview are targeted; resources created later are unaffected. The bot rechecks permission and hierarchy constraints before each operation. Failures are recorded individually and do not prevent the remaining targets from being attempted. Moderation operations are blocked while reset is running.

Discord prevents a literal deletion of everything. The server owner, this bot, `@everyone`, Discord-managed roles, roles assigned to this bot, and members/roles above the bot remain protected. Other permission restrictions can cause skipped or failed targets. Deleting a parent channel also removes its associated conversation space; threads are not independently listed as reset targets.

There is **no automatic rollback** or backup/restore feature. Deleted channels and roles are permanent. Banned members must be unbanned and reinvited. A process interruption marks the job interrupted on next startup; it never silently resumes. Inspect the log and generate a new preview for remaining resources. An in-flight Discord request may complete during a hard shutdown before its result is stored.

## Deploy the dashboard

For Railway, use the included production Dockerfile and follow [RAILWAY.md](RAILWAY.md) for the volume, domain, credentials, and initial owner key.

Run **one service process per data directory**. Keep `.data` on persistent local storage and limit filesystem access to the service account. It contains key hashes, session hashes, and moderation history. Live guild data lives at `.data/live-<server-id>/` by default; additional server directories are created when first opened. Authentication stays in the configured default server's database. It does not contain your raw staff keys or bot token.

For remote use, put the service behind HTTPS and set `PUBLIC_ORIGIN` to your exact public origin, without a trailing slash. Set `TRUST_PROXY` to the precise number of trusted proxy hops (`1` for a single reverse proxy); leave `0` for direct/local access. Keep the Node service bound to `127.0.0.1` behind that proxy, or use your platform’s internal container network. Restrict direct access to the application port. Access keys and sessions must travel over HTTPS. Do not embed keys in URLs.

Sessions use HttpOnly, SameSite=Strict cookies, expire after eight hours, and use Secure cookies for HTTPS origins. Mutations require an exact matching Origin and a session CSRF token. The app also provides a content security policy, security headers, request limits, and login throttling.

If outbound access is restricted, allow the Discord HTTPS API at `discord.com`, the gateway at `gateway.discord.gg`, and avatar images at `cdn.discordapp.com` and `media.discordapp.net`. Bot operation requires outbound WebSocket access to the Discord gateway, not just HTTPS requests. Node dependencies use `registry.npmjs.org`.

To recover owner access locally, run `npm run key:create -- --additional "Recovery owner"`. Existing owner keys remain valid; to invalidate a lost owner key, stop the service and use SQLite against the appropriate database to set that key’s `revoked` field to `1`. Never clear the whole database to rotate one key.

## Development and checks

```sh
npm run dev       # file-watching backend
npm run build     # strict TypeScript check; execution uses tsx
npm test          # backend, reset, session, and Discord adapter tests
npm run test:e2e  # Chromium dashboard test with an isolated demo server
```

The browser test uses the installed `/usr/bin/chromium` when available. Otherwise, run `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a compatible Chromium executable. Browser tests use a temporary data directory and port 3100; they never use your live guild or owner key.

The included tests exercise permissions, expiry, CSRF/origin protection, key revocation, SQLite persistence, reset preview/confirmation/replay, concurrency, partial failure, protected members and roles, and the browser journey from owner sign-in to staff reset. Live-server behavior still depends on your Discord credentials, permissions, and network connection; automated tests use a demo or mocked Discord API.

Use the existing checkout for cloud tasks. Each cloud task is already isolated; do not create Git worktrees unless specifically requested.

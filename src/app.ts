import express from 'express';
import type { Request } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import type { Actor, Gateway } from './types.js';
import type { Store } from './store.js';
import { Workspace, WorkspaceError } from './workspace.js';
import type { GuildContext } from './workspace.js';
import { DiscordCooldownError } from './errors.js';

type Options = { origin: string; secure: boolean; proxy: number; guildId?: string; dataRoot?: string };
const snowflake = z.string().regex(/^\d{17,20}$/, 'Enter a valid Discord ID');
const actionInput = z.object({ action: z.enum(['warn','timeout','untimeout','kick','ban','unban','purge']), target: snowflake, reason: z.string().trim().min(3).max(300), amount: z.number().int().positive().optional() }).superRefine((v,ctx) => {
  if (v.action === 'timeout' && (!v.amount || v.amount > 40320)) ctx.addIssue({ code: 'custom', message: 'Timeout must be 1–40320 minutes', path: ['amount'] });
  if (v.action === 'purge' && (!v.amount || v.amount > 100)) ctx.addIssue({ code: 'custom', message: 'Purge must be 1–100 messages', path: ['amount'] });
});
const tokenOf = (req: Request) => {
  const raw = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('disc_session='))?.slice(13);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : '';
};

export function createApp(store: Store, gateway: Gateway, options: Options) {
  const app = express();
  const workspace = new Workspace(store, gateway, options.guildId, options.dataRoot);
  app.locals.reset = workspace.primary.reset;
  app.locals.stop = () => workspace.stop();
  const context = (res: express.Response) => res.locals.context as GuildContext;
  const scopedKeys = (guildId: string) => store.keys().filter(k => k.owner || (k.guild_id || workspace.primary.guildId) === guildId);
  app.disable('x-powered-by');
  app.set('trust proxy', options.proxy);
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'https://cdn.discordapp.com', 'https://media.discordapp.net'], 'upgrade-insecure-requests': options.secure ? [] : null } }, strictTransportSecurity: options.secure ? undefined : false }));
  app.use(express.json({ limit: '12kb' }));
  app.use('/api', (_req,res,next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req,res,next) => {
    if (['POST','DELETE','PUT','PATCH'].includes(req.method) && req.headers.origin !== options.origin) { res.status(403).json({ error: 'Request origin does not match PUBLIC_ORIGIN' }); return; }
    next();
  });
  const loginLimit = rateLimit({ windowMs: 15 * 60000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } });
  app.get('/api/health', (_req,res) => res.json({ ok: true, mode: gateway.demo ? 'demo' : 'live' }));
  app.post('/api/login', loginLimit, (req,res) => {
    const { key } = z.object({ key: z.string().min(20).max(100) }).parse(req.body);
    const session = store.login(key);
    if (!session) { res.status(401).json({ error: 'Invalid, expired, or revoked access key' }); return; }
    res.cookie('disc_session', session.token, { httpOnly: true, secure: options.secure, sameSite: 'strict', maxAge: 8 * 3600000, path: '/' });
    store.audit(session.actor, 'login', 'dashboard', 'Access key sign-in');
    res.json({ actor: session.actor, csrf: session.csrf, demo: gateway.demo });
  });
  app.use('/api', (req,res,next) => {
    const session = store.session(tokenOf(req));
    if (!session) { res.status(401).json({ error: 'Sign in with a valid dashboard key' }); return; }
    res.locals.actor = session.actor;
    res.locals.csrf = session.csrf;
    if (['POST','DELETE','PUT','PATCH'].includes(req.method)) {
      const received = req.headers['x-csrf-token'];
      if (typeof received !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(received) || !timingSafeEqual(Buffer.from(received), Buffer.from(session.csrf))) { res.status(403).json({ error: 'Invalid session verification token. Refresh and try again.' }); return; }
    }
    next();
  });
  app.get('/api/session', (_req,res) => res.json({ actor: res.locals.actor, csrf: res.locals.csrf, demo: gateway.demo }));
  app.post('/api/logout', (req,res) => { store.logout(tokenOf(req)); res.clearCookie('disc_session', { path: '/', secure: options.secure, httpOnly: true, sameSite: 'strict' }); res.json({ ok: true }); });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Please wait a minute.' } }));
  app.get('/api/guilds', async (_req,res) => res.json({ guilds: await workspace.guilds(res.locals.actor), defaultGuildId: await workspace.defaultGuildId() }));
  app.use('/api', async (req,res,next) => {
    const requested = req.headers['x-discord-guild-id'];
    if (requested !== undefined && typeof requested !== 'string') { res.status(400).json({ error: 'Choose one server' }); return; }
    res.locals.context = await workspace.context(res.locals.actor, requested);
    next();
  });
  app.get('/api/overview', async (_req,res) => {
    const c = context(res);
    res.json({ guild: await c.gateway.snapshot(), logs: c.store.logs(), jobs: c.store.jobs(), resetRunning: c.reset.busy });
  });
  app.get('/api/logs', (_req,res) => res.json(context(res).store.logs()));
  app.get('/api/members/:id/warnings', (req,res) => res.json(context(res).store.warnings(snowflake.parse(req.params.id))));
  app.post('/api/moderate', async (req,res) => {
    const c = context(res);
    if (c.reset.busy) { res.status(409).json({ error: 'Wait until the reset finishes before moderating' }); return; }
    const input = actionInput.parse(req.body);
    const actor: Actor = res.locals.actor;
    c.moderationOperations++;
    try {
      const message = await c.gateway.moderate(input.action, input.target, `${input.reason} | Dashboard: ${actor.label} (${actor.id})`.slice(0,512), input.amount);
      c.store.audit(actor, input.action, input.target, input.reason);
      res.json({ message });
    } catch (e) {
      c.store.audit(actor, input.action, input.target, input.reason, 'failed'); throw e;
    } finally { c.moderationOperations--; }
  });
  app.post('/api/reset/preview', async (req,res) => {
    const choices = z.object({ members: z.boolean(), roles: z.boolean(), channels: z.boolean() }).refine(v => v.members || v.roles || v.channels, 'Select at least one reset operation').parse(req.body);
    res.json(await context(res).reset.preview(res.locals.actor, choices));
  });
  app.post('/api/reset/execute', (req,res) => {
    const c = context(res);
    if (c.moderationOperations) { res.status(409).json({ error: 'A moderation operation is running. Try again when it finishes.' }); return; }
    const input = z.object({ planId: z.uuid(), guildName: z.string().max(100), confirmation: z.string().max(30) }).parse(req.body);
    // Every valid key may reset the server it is authorized to access.
    res.status(202).json(c.reset.execute(res.locals.actor, input.planId, input.guildName, input.confirmation));
  });
  app.get('/api/jobs/:id', (req,res) => {
    const job = context(res).store.job(z.uuid().parse(req.params.id));
    if (!job) { res.status(404).json({ error: 'Reset job not found' }); return; }
    res.json(job);
  });
  app.use('/api/keys', (_req,res,next) => { if (!res.locals.actor.owner) { res.status(403).json({ error: 'Only the owner key can manage dashboard access' }); return; } next(); });
  app.get('/api/keys', (_req,res) => res.json(scopedKeys(context(res).guildId)));
  app.post('/api/keys', (req,res) => {
    const c = context(res);
    const input = z.object({ label: z.string().trim().min(2).max(60), days: z.number().int().min(1).max(365) }).parse(req.body);
    const issued = store.issueKey(input.label, false, input.days, c.guildId);
    c.store.audit(res.locals.actor, 'key-created', issued.id, `${input.label}; expires in ${input.days} days`);
    res.status(201).json(issued);
  });
  app.delete('/api/keys/:id', (req,res) => {
    const c = context(res);
    const id = z.uuid().parse(req.params.id);
    if (!scopedKeys(c.guildId).some(k => k.id === id && !k.owner) || !store.revoke(id)) { res.status(400).json({ error: 'Staff key not found; owner keys cannot be revoked from the dashboard' }); return; }
    c.store.audit(res.locals.actor, 'key-revoked', id, 'Dashboard access revoked immediately');
    res.json({ ok: true });
  });
  app.use('/api', (_req,res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { index: 'index.html' }));
  app.use((error: unknown, _req: Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof DiscordCooldownError) { res.set('Retry-After', String(error.retryAfter)); res.status(503).json({ error: error.message, retryAfter: error.retryAfter }); return; }
    if (error instanceof WorkspaceError) { res.status(error.status).json({ error: error.message }); return; }
    if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map(i => i.message).join('; ') }); return; }
    const message = error instanceof Error ? error.message : 'Operation failed';
    res.status(400).json({ error: message.replaceAll(process.env.DISCORD_TOKEN || '\u0000', '[redacted]') });
  });
  return app;
}

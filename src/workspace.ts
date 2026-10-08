import { join } from 'node:path';
import { Store } from './store.js';
import { ResetService } from './reset.js';
import type { Actor, Gateway, GuildSummary } from './types.js';

export class WorkspaceError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export type GuildContext = { guildId: string; store: Store; gateway: Gateway; reset: ResetService; moderationOperations: number };

export class Workspace {
  readonly primary: GuildContext;
  private contexts = new Map<string, Promise<GuildContext>>();
  private stopping = false;
  constructor(private store: Store, private gateway: Gateway, private defaultId = '', private dataRoot?: string) {
    this.primary = { guildId: defaultId, store, gateway, reset: new ResetService(store, gateway), moderationOperations: 0 };
    if (defaultId) this.contexts.set(defaultId, Promise.resolve(this.primary));
  }
  async defaultGuildId() {
    if (!this.defaultId) {
      this.defaultId = (await this.gateway.snapshot()).id;
      this.primary.guildId = this.defaultId;
      this.contexts.set(this.defaultId, Promise.resolve(this.primary));
    }
    return this.defaultId;
  }
  async guilds(actor: Actor): Promise<GuildSummary[]> {
    const primaryId = await this.defaultGuildId();
    const guilds = this.gateway.guilds ? await this.gateway.guilds() : [await this.gateway.snapshot()].map(g => ({ id: g.id, name: g.name, icon: g.icon }));
    return guilds.filter(g => actor.owner || g.id === (actor.guildId || primaryId));
  }
  async context(actor: Actor, requestedId?: string): Promise<GuildContext> {
    if (this.stopping) throw new WorkspaceError('The dashboard is shutting down', 503);
    const primaryId = await this.defaultGuildId();
    const id = requestedId || (actor.owner ? primaryId : actor.guildId || primaryId);
    if (!/^[0-9]{17,20}$/.test(id)) throw new WorkspaceError('Enter a valid server ID', 400);
    if (!actor.owner && id !== (actor.guildId || primaryId)) throw new WorkspaceError('This access key does not grant access to that server', 403);
    if (!(await this.guilds(actor)).some(g => g.id === id)) throw new WorkspaceError('The bot is not connected to this server', 404);
    if (!this.contexts.has(id)) {
      if (!this.dataRoot || !this.gateway.forGuild) throw new WorkspaceError('This server is not available', 404);
      const pending = this.gateway.forGuild(id).then(gateway => {
        const store = new Store(join(this.dataRoot!, this.gateway.demo ? `demo-${id}` : `live-${id}`));
        return { guildId: id, store, gateway, reset: new ResetService(store, gateway), moderationOperations: 0 };
      });
      this.contexts.set(id, pending);
      pending.catch(() => { if (this.contexts.get(id) === pending) this.contexts.delete(id); });
    }
    return this.contexts.get(id)!;
  }
  async stop() {
    this.stopping = true;
    const contexts = await Promise.allSettled(this.contexts.values());
    const live = new Set([this.primary, ...contexts.flatMap(c => c.status === 'fulfilled' ? [c.value] : [])]);
    await Promise.all([...live].map(async c => { await c.reset.stop(); if (c.store !== this.store) c.store.close(); }));
  }
}

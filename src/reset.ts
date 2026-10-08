import { randomUUID } from 'node:crypto';
import type { Actor, Gateway, Job, ResetPlan } from './types.js';
import { Store } from './store.js';

export class ResetService {
  private active: string | null = null;
  private stopping = false;
  private task: Promise<void> | null = null;
  constructor(private store: Store, private gateway: Gateway) {
    for (const job of store.jobs()) if (job.status === 'running' || job.status === 'queued') {
      job.status = 'interrupted'; store.saveJob(job);
    }
  }
  get busy() { return this.active !== null; }
  async preview(actor: Actor, choices: { members: boolean; roles: boolean; channels: boolean }): Promise<ResetPlan> {
    if (this.stopping) throw new Error('The dashboard is shutting down');
    if (this.busy) throw new Error('A reset is already running');
    const guild = await this.gateway.snapshot();
    const plan: ResetPlan = { id: randomUUID(), actorId: actor.id, expiresAt: Date.now() + 5 * 60000, guildId: guild.id, guildName: guild.name, items: [], skipped: [] };
    const add = (kind: 'member' | 'role' | 'channel', id: string, name: string, allowed: boolean, reason?: string) => {
      if (allowed) plan.items.push({ kind, id, name });
      else plan.skipped.push({ kind, id, name, reason: reason || 'Protected by Discord permissions or role hierarchy' });
    };
    if (choices.members) for (const m of guild.members) add('member', m.id, m.name, m.bannable && m.id !== guild.ownerId && m.id !== guild.botId, m.protectedReason);
    if (choices.roles) for (const r of guild.roles) add('role', r.id, r.name, r.editable, r.protectedReason);
    if (choices.channels) for (const c of [...guild.channels].sort((a,b) => Number(a.type === 'GuildCategory') - Number(b.type === 'GuildCategory'))) add('channel', c.id, c.name, c.deletable, c.protectedReason);
    this.store.plan(plan);
    this.store.audit(actor, 'reset-preview', guild.id, `${plan.items.length} targets, ${plan.skipped.length} protected`);
    return plan;
  }
  execute(actor: Actor, id: string, guildName: string, confirmation: string): Job {
    if (this.stopping) throw new Error('The dashboard is shutting down');
    if (this.busy) throw new Error('A reset is already running');
    const plan = this.store.readPlan(id);
    if (!plan || plan.actorId !== actor.id || plan.expiresAt <= Date.now()) throw new Error('Reset preview is invalid or expired. Create a new preview.');
    if (guildName !== plan.guildName || confirmation !== 'RESET SERVER') throw new Error('The server name and RESET SERVER confirmation must match exactly');
    if (!plan.items.length) throw new Error('There are no eligible targets to reset');
    // No await between checking the plan, consuming it, and obtaining the lock.
    this.store.consumePlan(id);
    const job: Job = { id: randomUUID(), actor: actor.label, status: 'queued', total: plan.items.length, processed: 0, succeeded: 0, failed: 0, createdAt: Date.now(), results: [] };
    this.active = job.id;
    this.store.saveJob(job);
    this.store.audit(actor, 'reset-start', plan.guildId, `${job.id}: ${job.total} targets`);
    this.task = this.run(actor, plan, job);
    return structuredClone(job);
  }
  private async run(actor: Actor, plan: ResetPlan, job: Job) {
    try {
      job.status = 'running'; this.store.saveJob(job);
      for (const item of plan.items) {
        if (this.stopping) { job.status = 'interrupted'; this.store.saveJob(job); return; }
        try {
          await this.gateway.resetTarget(item.kind, item.id, `Dashboard reset by ${actor.label} (${actor.id})`.slice(0,512));
          job.succeeded++; job.results.push({ ...item, ok: true });
          this.store.audit(actor, `reset-${item.kind}`, item.id, item.name);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Discord operation failed';
          job.failed++; job.results.push({ ...item, ok: false, error: message });
          this.store.audit(actor, `reset-${item.kind}`, item.id, message, 'failed');
        }
        job.processed++; this.store.saveJob(job);
      }
      job.status = 'completed'; this.store.saveJob(job);
      this.store.audit(actor, 'reset-complete', plan.guildId, `${job.succeeded} succeeded, ${job.failed} failed`);
    } catch {
      job.status = 'interrupted'; this.store.saveJob(job);
    } finally { this.active = null; }
  }
  async stop() { this.stopping = true; await this.task; }
}

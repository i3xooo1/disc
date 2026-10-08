export type Role = { id: string; name: string; editable: boolean; protectedReason?: string };
export type Member = { id: string; name: string; avatar: string | null; bot: boolean; bannable: boolean; kickable: boolean; moderatable: boolean; timedOut: boolean; protectedReason?: string };
export type Channel = { id: string; name: string; type: string; deletable: boolean; text: boolean; protectedReason?: string };
export type Snapshot = { id: string; name: string; icon: string | null; ownerId: string; botId: string; members: Member[]; channels: Channel[]; roles: Role[] };
export type Action = 'warn' | 'timeout' | 'untimeout' | 'kick' | 'ban' | 'unban' | 'purge';
export interface Gateway {
  demo: boolean;
  guilds?(): Promise<GuildSummary[]>;
  forGuild?(id: string): Promise<Gateway>;
  snapshot(): Promise<Snapshot>;
  moderate(action: Action, target: string, reason: string, amount?: number): Promise<string>;
  resetTarget(kind: 'member' | 'role' | 'channel', id: string, reason: string): Promise<void>;
  close(): Promise<void>;
}
export type GuildSummary = { id: string; name: string; icon: string | null };
export type Actor = { id: string; label: string; owner: boolean; guildId?: string };
export type ResetItem = { kind: 'member' | 'role' | 'channel'; id: string; name: string };
export type ResetPlan = { id: string; actorId: string; expiresAt: number; guildId: string; guildName: string; items: ResetItem[]; skipped: { kind: string; id: string; name: string; reason: string }[] };
export type Job = { id: string; actor: string; status: 'queued' | 'running' | 'completed' | 'interrupted'; total: number; processed: number; succeeded: number; failed: number; createdAt: number; results: { kind: string; id: string; name: string; ok: boolean; error?: string }[] };

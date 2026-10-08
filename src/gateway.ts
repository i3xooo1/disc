import { Client, GatewayIntentBits, PermissionsBitField, ChannelType } from 'discord.js';
import type { Guild } from 'discord.js';
import type { Action, Gateway, Snapshot } from './types.js';

export class DiscordGateway implements Gateway {
  demo = false;
  constructor(private client: Client, private guild: Guild) {}
  static async connect(token: string, guildId: string) {
    const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildMessages] });
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Discord connection timed out. Check the token and enabled Server Members Intent.')), 30000);
      client.once('clientReady', () => { clearTimeout(timer); resolve(); });
      client.once('error', e => { clearTimeout(timer); reject(e); });
    });
    try {
      await Promise.all([client.login(token), ready]);
      const guild = await client.guilds.fetch(guildId);
      await guild.members.fetchMe();
      return new DiscordGateway(client, guild);
    } catch (e) { client.destroy(); throw e; }
  }
  async snapshot(): Promise<Snapshot> {
    const [members, channels, roles, me] = await Promise.all([this.guild.members.fetch(), this.guild.channels.fetch(), this.guild.roles.fetch(), this.guild.members.fetchMe()]);
    return {
      id: this.guild.id, name: this.guild.name, icon: this.guild.iconURL(), ownerId: this.guild.ownerId, botId: me.id,
      members: members.map(m => ({ id: m.id, name: m.displayName, avatar: m.displayAvatarURL({ size: 64 }), bot: m.user.bot, bannable: m.bannable && m.id !== me.id, kickable: m.kickable && m.id !== me.id, moderatable: m.moderatable && m.id !== me.id, timedOut: m.isCommunicationDisabled(), protectedReason: m.id === this.guild.ownerId ? 'Server owner' : m.id === me.id ? 'This bot' : !m.bannable ? 'Bot permissions or role hierarchy' : undefined })),
      roles: roles.map(r => ({ id: r.id, name: r.name, editable: r.editable && !me.roles.cache.has(r.id), protectedReason: r.id === this.guild.id ? '@everyone' : r.managed ? 'Discord-managed role' : me.roles.cache.has(r.id) ? 'Role assigned to this bot' : !r.editable ? 'Bot permissions or role hierarchy' : undefined })),
      channels: channels.filter(c => c !== null).map(c => ({ id: c.id, name: c.name, type: ChannelType[c.type], deletable: c.deletable, text: c.isTextBased() && 'bulkDelete' in c, protectedReason: !c.deletable ? 'Missing Manage Channels permission' : undefined }))
    };
  }
  async moderate(action: Action, target: string, reason: string, amount?: number) {
    if (action === 'unban') { await this.guild.bans.remove(target, reason); return 'Member unbanned'; }
    if (action === 'purge') {
      const channel = await this.guild.channels.fetch(target);
      if (!channel || !channel.isTextBased() || !('bulkDelete' in channel)) throw new Error('Choose a text channel that supports bulk deletion');
      const me = await this.guild.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages])) throw new Error('Bot needs View Channel, Read Message History, and Manage Messages here');
      const messages = await channel.bulkDelete(amount!, true);
      return `Deleted ${messages.size} messages. Messages older than 14 days were skipped.`;
    }
    const member = await this.guild.members.fetch(target);
    if (action === 'warn') return 'Warning recorded in the dashboard moderation log';
    if (member.id === this.guild.ownerId || member.id === this.client.user!.id) throw new Error('The server owner and this bot are protected');
    if (action === 'ban') { if (!member.bannable) throw new Error('Member cannot be banned: check bot permissions and role hierarchy'); await member.ban({ reason }); return 'Member banned'; }
    if (action === 'kick') { if (!member.kickable) throw new Error('Member cannot be kicked: check bot permissions and role hierarchy'); await member.kick(reason); return 'Member kicked'; }
    if (!member.moderatable) throw new Error('Member cannot be timed out: check bot permissions and role hierarchy');
    await member.timeout(action === 'untimeout' ? null : amount! * 60000, reason);
    return action === 'untimeout' ? 'Timeout removed' : `Member timed out for ${amount} minutes`;
  }
  async resetTarget(kind: 'member' | 'role' | 'channel', id: string, reason: string) {
    if (kind === 'member') { await this.moderate('ban', id, reason); return; }
    if (kind === 'role') {
      const role = await this.guild.roles.fetch(id);
      const me = await this.guild.members.fetchMe();
      if (!role || !role.editable || me.roles.cache.has(id)) throw new Error('Role is missing or protected by Discord or assigned to this bot');
      await role.delete(reason); return;
    }
    const channel = await this.guild.channels.fetch(id);
    if (!channel || !('deletable' in channel) || !channel.deletable) throw new Error('Channel is missing or not deletable');
    await channel.delete(reason);
  }
  async close() { this.client.destroy(); }
}

export class DemoGateway implements Gateway {
  demo = true;
  state: Snapshot = {
    id: '100000000000000001', name: 'The Midnight Collective', icon: null, ownerId: '100000000000000002', botId: '100000000000000003',
    members: [
      { id: '100000000000000002', name: 'Alex · owner', avatar: null, bot: false, bannable: false, kickable: false, moderatable: false, timedOut: false, protectedReason: 'Server owner' },
      { id: '100000000000000003', name: 'Disc Control', avatar: null, bot: true, bannable: false, kickable: false, moderatable: false, timedOut: false, protectedReason: 'This bot' },
      ...['Sophie', 'Marcus', 'Luna', 'Oliver', 'Maya', 'Theo', 'Elena', 'Jasper'].map((name, i) => ({ id: String(100000000000000010n + BigInt(i)), name, avatar: null, bot: false, bannable: true, kickable: true, moderatable: true, timedOut: i === 3 }))
    ],
    channels: ['general', 'introductions', 'announcements', 'off-topic', 'bot-commands', 'Voice lounge'].map((name, i) => ({ id: String(100000000000000100n + BigInt(i)), name, type: i === 5 ? 'GuildVoice' : 'GuildText', deletable: true, text: i !== 5 })),
    roles: [ { id: '100000000000000001', name: '@everyone', editable: false, protectedReason: '@everyone' }, { id: '100000000000000200', name: 'Disc Control', editable: false, protectedReason: 'Role assigned to this bot' }, ...['Moderator', 'Member', 'VIP'].map((name, i) => ({ id: String(100000000000000201n + BigInt(i)), name, editable: true })) ]
  };
  async snapshot() { return structuredClone(this.state); }
  async moderate(action: Action, target: string, _reason: string, amount?: number) {
    if (action === 'purge') { if (!this.state.channels.some(c => c.id === target && c.text)) throw new Error('Text channel not found'); return `Deleted ${amount} simulated messages`; }
    if (action === 'unban') return 'Member unbanned (demo)';
    const member = this.state.members.find(m => m.id === target);
    if (!member) throw new Error('Member not found');
    if (action === 'warn') return 'Warning recorded in the dashboard moderation log';
    if (!member.bannable) throw new Error('The server owner and this bot are protected');
    if (action === 'ban' || action === 'kick') this.state.members = this.state.members.filter(m => m.id !== target);
    if (action === 'timeout' || action === 'untimeout') member.timedOut = action === 'timeout';
    return `${action} completed (demo)`;
  }
  async resetTarget(kind: 'member' | 'role' | 'channel', id: string, reason: string) {
    if (kind === 'member') return void await this.moderate('ban', id, reason);
    if (kind === 'role') { if (!this.state.roles.find(r => r.id === id)?.editable) throw new Error('Protected role'); this.state.roles = this.state.roles.filter(r => r.id !== id); }
    if (kind === 'channel') { if (!this.state.channels.find(c => c.id === id)?.deletable) throw new Error('Protected channel'); this.state.channels = this.state.channels.filter(c => c.id !== id); }
  }
  async close() {}
}

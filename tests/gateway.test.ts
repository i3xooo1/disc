import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client, Guild } from 'discord.js';
import { Collection, PermissionsBitField } from 'discord.js';
import { DiscordCooldownError } from '../src/errors.js';
import { DiscordGateway } from '../src/gateway.js';

function adapter() {
  const calls: { action:string; value:unknown }[]=[];
  const member={id:'100000000000000010',bannable:true,kickable:true,moderatable:true,ban:async(value:unknown)=>calls.push({action:'ban',value}),kick:async(value:unknown)=>calls.push({action:'kick',value}),timeout:async(value:unknown,reason:unknown)=>calls.push({action:'timeout',value:[value,reason]})};
  const role={editable:true,delete:async(reason:unknown)=>calls.push({action:'delete-role',value:reason})};
  const channel={isTextBased:()=>true,permissionsFor:()=>new PermissionsBitField(['ViewChannel','ReadMessageHistory','ManageMessages']),bulkDelete:async(amount:unknown,filterOld:unknown)=>{calls.push({action:'purge',value:[amount,filterOld]});return {size:3};},deletable:true,delete:async(reason:unknown)=>calls.push({action:'delete-channel',value:reason})};
  const assignedRoles=new Set<string>(['100000000000000200']);
  const guild={ownerId:'100000000000000002',members:{fetch:async()=>member,fetchMe:async()=>({roles:{cache:assignedRoles}})},roles:{fetch:async()=>role},channels:{fetch:async()=>channel},bans:{remove:async(id:unknown,reason:unknown)=>calls.push({action:'unban',value:[id,reason]})}};
  const gateway=new DiscordGateway({user:{id:'100000000000000003'}} as unknown as Client,guild as unknown as Guild);
  return {gateway,member,role,channel,calls};
}

test('live adapter enforces member hierarchy and sends timeout durations in milliseconds',async()=>{
  const f=adapter();
  await f.gateway.moderate('timeout',f.member.id,'Spam',15);
  assert.deepEqual(f.calls[0],{action:'timeout',value:[900000,'Spam']});
  await f.gateway.moderate('untimeout',f.member.id,'Appeal');
  assert.deepEqual(f.calls[1],{action:'timeout',value:[null,'Appeal']});
  f.member.bannable=false;
  await assert.rejects(()=>f.gateway.moderate('ban',f.member.id,'Spam'),/hierarchy/);
  f.member.id='100000000000000002';
  await assert.rejects(()=>f.gateway.moderate('kick',f.member.id,'Test'),/protected/);
  assert.equal(f.calls.length,2,'Protected operations must never reach Discord');
});

test('live adapter skips old messages during purge and protects bot-assigned roles during reset',async()=>{
  const f=adapter();
  const result=await f.gateway.moderate('purge','100000000000000100','Spam',10);
  assert.deepEqual(f.calls[0],{action:'purge',value:[10,true]});assert.match(result,/Deleted 3 messages/);
  await assert.rejects(()=>f.gateway.resetTarget('role','100000000000000200','Reset'),/assigned to this bot/);
  assert.equal(f.calls.length,1);
  await f.gateway.resetTarget('role','100000000000000201','Reset');
  assert.equal(f.calls[1]!.action,'delete-role');
  f.channel.deletable=false;
  await assert.rejects(()=>f.gateway.resetTarget('channel','100000000000000100','Reset'),/not deletable/);
});

function snapshotAdapter() {
  const member = { id: '100000000000000010', displayName: 'Sophie', displayAvatarURL: () => null, user: { bot: false }, bannable: true, kickable: true, moderatable: true, timedOut: false, isCommunicationDisabled() { return this.timedOut; } };
  const cache = new Collection([[member.id, member]]);
  const controls = { fetches: 0, action: async () => {} };
  const guild = {
    id: '100000000000000001', name: 'Test server', ownerId: '100000000000000002', iconURL: () => null,
    members: { cache, fetch: async () => { controls.fetches++; await controls.action(); return cache; }, fetchMe: async () => ({ id: '100000000000000003', roles: { cache: new Set() } }) },
    channels: { fetch: async () => new Collection() }, roles: { fetch: async () => new Collection() }
  };
  return { gateway: new DiscordGateway({} as Client, guild as unknown as Guild), cache, member, controls };
}

test('concurrent refreshes share one member fetch and subsequent snapshots use live cache updates', async t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const f = snapshotAdapter();
  let release!: () => void;
  f.controls.action = () => new Promise<void>(resolve => { release = resolve; });
  const requests = Array.from({ length: 5 }, () => f.gateway.snapshot());
  assert.equal(f.controls.fetches, 1);
  release(); await Promise.all(requests);
  f.controls.action = async () => {};
  now += 59000;
  f.member.timedOut = true;
  f.cache.set('100000000000000011', { ...f.member, id: '100000000000000011', displayName: 'New member' });
  const updated = await f.gateway.snapshot();
  assert.equal(updated.members.length, 2);
  assert.equal(updated.members[0]!.timedOut, true);
  assert.equal(f.controls.fetches, 1);
  f.cache.delete(f.member.id);
  assert.equal((await f.gateway.snapshot()).members.length, 1);
  now += 2000;
  await f.gateway.snapshot();
  assert.equal(f.controls.fetches, 2);
});

test('initial rate limit blocks early retries without presenting a partial member list', async t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const f = snapshotAdapter();
  f.controls.action = async () => { throw Object.assign(new Error('rate limited'), { data: { opcode: 8, retry_after: 25.528 } }); };
  await assert.rejects(() => f.gateway.snapshot(), e => e instanceof DiscordCooldownError && e.retryAfter === 27);
  now += 10000;
  await assert.rejects(() => f.gateway.snapshot(), e => e instanceof DiscordCooldownError && e.retryAfter === 17);
  assert.equal(f.controls.fetches, 1);
  f.controls.action = async () => {};
  now += 18000;
  assert.equal((await f.gateway.snapshot()).members.length, 1);
  assert.equal(f.controls.fetches, 2);
});

test('rate limited resync keeps the complete cache usable until Discord permits another request', async t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const f = snapshotAdapter();
  await f.gateway.snapshot();
  now += 61000;
  f.controls.action = async () => { throw Object.assign(new Error('rate limited'), { data: { opcode: 8, retry_after: 30 } }); };
  assert.equal((await f.gateway.snapshot()).members.length, 1);
  await f.gateway.snapshot();
  assert.equal(f.controls.fetches, 2);
  now += 32000;
  f.controls.action = async () => {};
  await f.gateway.snapshot();
  assert.equal(f.controls.fetches, 3);
});

test('failed initial member fetch can recover without a stuck pending request', async () => {
  const f = snapshotAdapter();
  f.controls.action = async () => { throw new Error('Connection lost'); };
  await assert.rejects(() => f.gateway.snapshot(), /Connection lost/);
  f.controls.action = async () => {};
  assert.equal((await f.gateway.snapshot()).members.length, 1);
  assert.equal(f.controls.fetches, 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Client, Guild } from 'discord.js';
import { PermissionsBitField } from 'discord.js';
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

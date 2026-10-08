import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/store.js';
import { DemoGateway } from '../src/gateway.js';
import { createApp } from '../src/app.js';
import { ResetService } from '../src/reset.js';
import type { Actor, Job } from '../src/types.js';

const origin = 'http://localhost:3000';
async function fixture(gateway = new DemoGateway()) {
  const directory = mkdtempSync(join(tmpdir(),'disc-test-'));
  const store = new Store(directory);
  const owner = store.issueKey('Owner',true,null), staff = store.issueKey('Sophie',false,30);
  const app = createApp(store,gateway,{origin,secure:false,proxy:0});
  const server: Server = await new Promise(resolve => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, options: { method?: string; body?: unknown; cookie?: string; csrf?: string; origin?: string }={}) {
    const response = await fetch(`${base}/api${path}`,{ method:options.method||'GET', headers:{'Content-Type':'application/json',Origin:options.origin??origin,...(options.cookie?{Cookie:options.cookie}:{}),...(options.csrf?{'X-CSRF-Token':options.csrf}:{})},...(options.body?{body:JSON.stringify(options.body)}:{}) });
    return { status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0], headers:response.headers };
  }
  async function login(key:string) { const r=await request('/login',{method:'POST',body:{key}}); assert.equal(r.status,200); return {cookie:r.cookie!,csrf:r.body.csrf as string,actor:r.body.actor as Actor}; }
  async function close() { await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())); store.close(); rmSync(directory,{recursive:true,force:true}); }
  return { store,gateway,owner,staff,request,login,close };
}
async function waitForJob(store:Store,id:string):Promise<Job> {
  for(let i=0;i<100;i++) {const job=store.job(id)!;if(!['queued','running'].includes(job.status)) return job;await new Promise(r=>setTimeout(r,5));}
  throw new Error('Reset did not complete');
}

test('dashboard auth, origin protection, CSRF, and owner-only key management',async()=>{
  const f=await fixture();
  try {
    assert.equal((await f.request('/overview')).status,401);
    assert.equal((await f.request('/login',{method:'POST',origin:'https://evil.example',body:{key:f.owner.key}})).status,403);
    assert.equal((await f.request('/login',{method:'POST',body:{key:'disc_invalid_key_that_is_long_enough'}})).status,401);
    const auth=await f.login(f.staff.key);
    const login=await f.request('/login',{method:'POST',body:{key:f.owner.key}});
    assert.match(login.headers.get('set-cookie')!,/HttpOnly/);
    assert.match(login.headers.get('set-cookie')!,/SameSite=Strict/);
    assert.equal((await f.request('/keys',auth)).status,403);
    assert.equal((await f.request('/keys',{...auth,method:'POST',body:{label:'Unauthorized',days:30}})).status,403);
    assert.equal((await f.request('/moderate',{cookie:auth.cookie,method:'POST',body:{action:'warn',target:'100000000000000010',reason:'Test warning'}})).status,403);
    assert.equal((await f.request('/logout',{...auth,method:'POST',origin:'https://evil.example',body:{}})).status,403);
    assert.equal((await f.request('/overview',auth)).status,200);
  }finally{await f.close();}
});

test('owner generates one-time staff keys and revocation immediately invalidates sessions',async()=>{
  const f=await fixture();
  try {
    const owner=await f.login(f.owner.key);
    const issued=await f.request('/keys',{...owner,method:'POST',body:{label:'Marcus',days:7}});
    assert.equal(issued.status,201); assert.match(issued.body.key,/^disc_/);
    const staff=await f.login(issued.body.key);
    const list=await f.request('/keys',owner);
    assert.ok(!JSON.stringify(list.body).includes(issued.body.key));
    assert.ok(!JSON.stringify(list.body).includes('hash'));
    assert.equal((await f.request(`/keys/${issued.body.id}`,{...owner,method:'DELETE'})).status,200);
    assert.equal((await f.request('/overview',staff)).status,401);
    assert.equal((await f.request('/login',{method:'POST',body:{key:issued.body.key}})).status,401);
    assert.equal((await f.request(`/keys/${f.owner.id}`,{...owner,method:'DELETE'})).status,400);
  }finally{await f.close();}
});

test('moderation validates limits, records warnings, applies timeouts and purges',async()=>{
  const f=await fixture();
  try {
    const auth=await f.login(f.staff.key);
    const target='100000000000000010';
    const action=(body:unknown)=>f.request('/moderate',{...auth,method:'POST',body});
    assert.equal((await action({action:'timeout',target,reason:'Spam',amount:40321})).status,400);
    assert.equal((await action({action:'purge',target:'100000000000000100',reason:'Spam',amount:101})).status,400);
    assert.equal((await action({action:'warn',target,reason:'Repeated spam'})).status,200);
    const warnings=await f.request(`/members/${target}/warnings`,auth);
    assert.equal(warnings.body.length,1); assert.equal(warnings.body[0].reason,'Repeated spam'); assert.match(warnings.body[0].actor,/Sophie/);
    assert.equal((await action({action:'timeout',target,reason:'Repeated spam',amount:60})).status,200);
    assert.equal((await f.gateway.snapshot()).members.find(m=>m.id===target)!.timedOut,true);
    assert.equal((await action({action:'untimeout',target,reason:'Appeal accepted'})).status,200);
    assert.equal((await action({action:'purge',target:'100000000000000100',reason:'Spam cleanup',amount:20})).body.message,'Deleted 20 simulated messages');
    assert.equal((await action({action:'ban',target:'100000000000000002',reason:'Test protected owner'})).status,400);
  }finally{await f.close();}
});

test('staff can reset with a bound preview and exact confirmation; owner, bot, and protected roles survive',async()=>{
  const f=await fixture();
  try {
    const staff=await f.login(f.staff.key),owner=await f.login(f.owner.key);
    const preview=await f.request('/reset/preview',{...staff,method:'POST',body:{members:true,roles:true,channels:true}});
    assert.equal(preview.status,200); assert.equal(preview.body.items.length,17); assert.equal(preview.body.skipped.length,4);
    assert.equal((await f.gateway.snapshot()).members.length,10,'Preview must not mutate Discord');
    const body={planId:preview.body.id,guildName:preview.body.guildName,confirmation:'RESET SERVER'};
    assert.equal((await f.request('/reset/execute',{...owner,method:'POST',body})).status,400,'Another key cannot execute the preview');
    assert.equal((await f.request('/reset/execute',{...staff,method:'POST',body:{...body,confirmation:'reset server'}})).status,400);
    const execution=await f.request('/reset/execute',{...staff,method:'POST',body});
    assert.equal(execution.status,202);
    const job=await waitForJob(f.store,execution.body.id);
    assert.equal(job.status,'completed'); assert.equal(job.succeeded,17); assert.equal(job.failed,0);
    const remaining=await f.gateway.snapshot();
    assert.deepEqual(remaining.members.map(m=>m.id),[remaining.ownerId,remaining.botId]);
    assert.equal(remaining.channels.length,0); assert.equal(remaining.roles.length,2);
    assert.equal((await f.request('/reset/execute',{...staff,method:'POST',body})).status,400,'A reset preview is single-use');
  }finally{await f.close();}
});

test('reset handles partial failure, excludes unselected resources and targets created after preview',async()=>{
  class FailureGateway extends DemoGateway {
    override async resetTarget(kind:'member'|'role'|'channel',id:string,reason:string) {
      if(id==='100000000000000100') throw new Error('Missing permissions');
      return super.resetTarget(kind,id,reason);
    }
  }
  const f=await fixture(new FailureGateway());
  try {
    const actor=(await f.login(f.staff.key)).actor;
    const reset=new ResetService(f.store,f.gateway);
    const plan=await reset.preview(actor,{members:false,roles:false,channels:true});
    f.gateway.state.channels.push({id:'100000000000000199',name:'Created later',type:'GuildText',text:true,deletable:true});
    const result=reset.execute(actor,plan.id,plan.guildName,'RESET SERVER');
    const job=await waitForJob(f.store,result.id);
    assert.equal(job.succeeded,5);assert.equal(job.failed,1);assert.equal(job.processed,6);
    assert.equal(job.results.find(r=>!r.ok)!.error,'Missing permissions');
    const remaining=await f.gateway.snapshot();
    assert.equal(remaining.members.length,10);assert.equal(remaining.roles.length,5);assert.equal(remaining.channels.length,2);
    assert.ok(f.store.logs().some(l=>l.status==='failed'&&l.action==='reset-channel'));
  }finally{await f.close();}
});

test('reset locks concurrent operations and rejects expired plans',async()=>{
  let release!:()=>void;
  const block=new Promise<void>(resolve=>release=resolve);
  class SlowGateway extends DemoGateway {
    override async resetTarget(kind:'member'|'role'|'channel',id:string,reason:string) { await block; return super.resetTarget(kind,id,reason); }
  }
  const f=await fixture(new SlowGateway());
  try {
    const staff=await f.login(f.staff.key);
    const expired=await f.request('/reset/preview',{...staff,method:'POST',body:{members:true,roles:false,channels:false}});
    const p=f.store.readPlan(expired.body.id)!;p.expiresAt=Date.now()-1;f.store.db.prepare('UPDATE plans SET data=? WHERE id=?').run(JSON.stringify(p),p.id);
    assert.equal((await f.request('/reset/execute',{...staff,method:'POST',body:{planId:p.id,guildName:p.guildName,confirmation:'RESET SERVER'}})).status,400);
    const preview=await f.request('/reset/preview',{...staff,method:'POST',body:{members:true,roles:false,channels:false}});
    const input={...staff,method:'POST',body:{planId:preview.body.id,guildName:preview.body.guildName,confirmation:'RESET SERVER'}};
    const execution=await f.request('/reset/execute',input);
    assert.equal(execution.status,202);
    assert.equal((await f.request('/reset/execute',input)).status,400);
    assert.equal((await f.request('/moderate',{...staff,method:'POST',body:{action:'warn',target:'100000000000000010',reason:'During reset'}})).status,409);
    release();await waitForJob(f.store,execution.body.id);
  }finally{release();await f.close();}
});

test('restart marks unfinished jobs interrupted without rerunning destructive operations',()=>{
  const directory=mkdtempSync(join(tmpdir(),'disc-restart-'));
  let store=new Store(directory);
  const job:Job={id:'unfinished',actor:'Sophie',status:'running',total:20,processed:5,succeeded:4,failed:1,createdAt:Date.now(),results:[]};
  store.saveJob(job);store.close();store=new Store(directory);
  const gateway=new DemoGateway();new ResetService(store,gateway);
  assert.equal(store.job(job.id)!.status,'interrupted');assert.equal(gateway.state.members.length,10);
  store.close();rmSync(directory,{recursive:true,force:true});
});

test('expired keys fail sign-in and session checks; SQLite persists warnings across restart',()=>{
  const directory=mkdtempSync(join(tmpdir(),'disc-store-'));
  let store=new Store(directory);
  const key=store.issueKey('Expired staff',false,-1);
  assert.equal(store.login(key.key),null);
  const good=store.issueKey('Moderator');const session=store.login(good.key)!;
  assert.equal(store.session(session.token)!.actor.label,'Moderator');
  store.db.prepare('UPDATE keys SET expires=? WHERE id=?').run(Date.now()-1,good.id);
  assert.equal(store.session(session.token),null);
  store.audit(session.actor,'warn','100000000000000010','Persist this warning');store.close();
  store=new Store(directory);assert.equal(store.warnings('100000000000000010').length,1);
  store.close();rmSync(directory,{recursive:true,force:true});
});

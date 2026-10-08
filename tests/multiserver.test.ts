import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Store } from '../src/store.js';
import { MultiDemoGateway } from '../src/gateway.js';
import { createApp } from '../src/app.js';

const primary = '100000000000000001', secondary = '100000000000000009';
const origin = 'http://localhost:3000';
type Auth = { cookie: string; csrf: string };
async function fixture(directory = mkdtempSync(join(tmpdir(), 'disc-multi-'))) {
  const store = new Store(join(directory, 'demo'));
  const gateway = new MultiDemoGateway();
  const app = createApp(store, gateway, { origin, secure: false, proxy: 0, guildId: primary, dataRoot: directory });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  async function request(path: string, options: Partial<Auth> & { method?: string; body?: unknown; guild?: string } = {}) {
    const response = await fetch(base + path, { method: options.method || 'GET', headers: { 'Content-Type': 'application/json', Origin: origin,
      ...(options.cookie ? { Cookie: options.cookie } : {}), ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
      ...(options.guild ? { 'X-Discord-Guild-ID': options.guild } : {}) }, ...(options.body ? { body: JSON.stringify(options.body) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function login(key: string): Promise<Auth> {
    const result = await request('/login', { method: 'POST', body: { key } });
    assert.equal(result.status, 200);
    return { cookie: result.cookie!, csrf: result.body.csrf };
  }
  async function close(remove = true) {
    await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    await app.locals.stop(); store.close();
    if (remove) rmSync(directory, { recursive: true, force: true });
  }
  return { directory, store, gateway, request, login, close };
}

test('owner discovers and switches servers; unauthenticated and unavailable servers are rejected', async () => {
  const f = await fixture();
  try {
    const owner = await f.login(f.store.issueKey('Owner', true, null).key);
    assert.equal((await f.request('/guilds')).status, 401);
    const list = await f.request('/guilds', owner);
    assert.deepEqual(list.body.guilds.map((g: { id: string }) => g.id), [primary, secondary]);
    assert.equal(list.body.defaultGuildId, primary);
    assert.equal((await f.request('/overview', { ...owner, guild: secondary })).body.guild.name, 'The Daylight Collective');
    assert.equal((await f.request('/overview', owner)).body.guild.name, 'The Midnight Collective');
    assert.equal((await f.request('/overview', { ...owner, guild: '../escape' })).status, 400);
    assert.equal((await f.request('/overview', { ...owner, guild: '100000000000000099' })).status, 404);
  } finally { await f.close(); }
});

test('legacy staff remain in their original server and new staff keys are scoped to the selected server', async () => {
  const f = await fixture();
  try {
    const owner = await f.login(f.store.issueKey('Owner', true, null).key);
    const legacy = await f.login(f.store.issueKey('Existing moderator').key);
    assert.deepEqual((await f.request('/guilds', legacy)).body.guilds.map((g: { id: string }) => g.id), [primary]);
    assert.equal((await f.request('/overview', { ...legacy, guild: secondary })).status, 403);
    assert.equal((await f.request('/moderate', { ...legacy, guild: secondary, method: 'POST', body: { action: 'warn', target: '100000000000000010', reason: 'Must be rejected' } })).status, 403);
    const issued = await f.request('/keys', { ...owner, guild: secondary, method: 'POST', body: { label: 'Second server staff', days: 30 } });
    const staff = await f.login(issued.body.key);
    assert.deepEqual((await f.request('/guilds', staff)).body.guilds.map((g: { id: string }) => g.id), [secondary]);
    assert.equal((await f.request('/overview', staff)).body.guild.id, secondary);
    assert.equal((await f.request('/overview', { ...staff, guild: primary })).status, 403);
    assert.equal((await f.request('/keys', { ...owner, guild: primary })).body.some((k: { id: string }) => k.id === issued.body.id), false);
    assert.equal((await f.request('/keys', { ...staff, guild: secondary })).status, 403);
    assert.equal((await f.request(`/keys/${issued.body.id}`, { ...owner, guild: secondary, method: 'DELETE' })).status, 200);
    assert.equal((await f.request('/overview', staff)).status, 401);
  } finally { await f.close(); }
});

test('warnings, reset previews, jobs, and mutations are isolated between servers', async () => {
  const f = await fixture();
  try {
    const owner = await f.login(f.store.issueKey('Owner', true, null).key);
    const target = '100000000000000010';
    assert.equal((await f.request('/moderate', { ...owner, guild: secondary, method: 'POST', body: { action: 'warn', target, reason: 'Second server warning' } })).status, 200);
    assert.equal((await f.request(`/members/${target}/warnings`, { ...owner, guild: primary })).body.length, 0);
    assert.equal((await f.request(`/members/${target}/warnings`, { ...owner, guild: secondary })).body.length, 1);
    const preview = await f.request('/reset/preview', { ...owner, guild: primary, method: 'POST', body: { members: false, roles: false, channels: true } });
    const execution = { planId: preview.body.id, guildName: preview.body.guildName, confirmation: 'RESET SERVER' };
    assert.equal((await f.request('/reset/execute', { ...owner, guild: secondary, method: 'POST', body: execution })).status, 400);
    assert.equal((await f.gateway.snapshot()).channels.length, 6);
    const secondPreview = await f.request('/reset/preview', { ...owner, guild: secondary, method: 'POST', body: { members: false, roles: false, channels: true } });
    const started = await f.request('/reset/execute', { ...owner, guild: secondary, method: 'POST', body: { planId: secondPreview.body.id, guildName: secondPreview.body.guildName, confirmation: 'RESET SERVER' } });
    assert.equal(started.status, 202);
    let job;
    for (let i = 0; i < 100; i++) {
      job = await f.request(`/jobs/${started.body.id}`, { ...owner, guild: secondary });
      if (job.body.status === 'completed') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(job!.body.succeeded, 6);
    assert.equal((await f.request(`/jobs/${started.body.id}`, { ...owner, guild: primary })).status, 404);
    assert.equal((await f.gateway.snapshot()).channels.length, 6);
    assert.equal((await f.request('/overview', { ...owner, guild: secondary })).body.guild.channels.length, 0);
    assert.equal((await f.request('/logs', { ...owner, guild: primary })).body.some((l: { action: string }) => l.action === 'reset-channel'), false);
  } finally { await f.close(); }
});

test('per-server data and scoped sessions persist across restart without replacing owner access', async () => {
  let f = await fixture();
  const directory = f.directory;
  const ownerKey = f.store.issueKey('Owner', true, null).key;
  const owner = await f.login(ownerKey);
  const issued = await f.request('/keys', { ...owner, guild: secondary, method: 'POST', body: { label: 'Persistent staff', days: 30 } });
  const staff = await f.login(issued.body.key);
  await f.request('/moderate', { ...staff, guild: secondary, method: 'POST', body: { action: 'warn', target: '100000000000000010', reason: 'Persist across restart' } });
  await f.close(false);
  f = await fixture(directory);
  try {
    assert.equal((await f.request('/overview', staff)).body.guild.id, secondary);
    assert.equal((await f.request('/overview', { ...staff, guild: primary })).status, 403);
    assert.equal((await f.request('/logs', { ...staff, guild: secondary })).body.some((l: { reason: string }) => l.reason === 'Persist across restart'), true);
    assert.equal((await f.request('/logs', await f.login(ownerKey))).body.some((l: { reason: string }) => l.reason === 'Persist across restart'), false);
  } finally { await f.close(); }
});

test('database migration preserves existing owner, staff keys, and sessions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'disc-migration-'));
  let store = new Store(directory);
  try {
    const owner = store.issueKey('Original owner', true, null), staff = store.issueKey('Original staff');
    const session = store.login(staff.key)!;
    store.db.exec('ALTER TABLE keys DROP COLUMN guild_id'); store.close();
    store = new Store(directory);
    assert.equal(store.login(owner.key)?.actor.owner, true);
    assert.equal(store.session(session.token)?.actor.label, 'Original staff');
    assert.equal(store.session(session.token)?.actor.guildId, undefined);
    assert.equal(store.keys().length, 2);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

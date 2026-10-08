import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Actor, Job, ResetPlan } from './types.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export class Store {
  db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'dashboard.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS keys(id TEXT PRIMARY KEY, hash TEXT UNIQUE NOT NULL, label TEXT NOT NULL, owner INTEGER NOT NULL, expires INTEGER, revoked INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, key_id TEXT NOT NULL REFERENCES keys(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS logs(id TEXT PRIMARY KEY, time INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
  }
  bootstrapOwner(keyHash: string) {
    if (!/^[a-f0-9]{64}$/.test(keyHash)) throw new Error('BOOTSTRAP_OWNER_KEY_SHA256 must be a SHA-256 hash');
    if (this.keys().some(key => key.owner && !key.revoked)) return false;
    this.db.prepare('INSERT INTO keys(id,hash,label,owner,expires,created) VALUES(?,?,?,?,?,?)')
      .run(randomUUID(), keyHash, 'Server owner', 1, null, Date.now());
    return true;
  }
  issueKey(label: string, owner = false, days: number | null = 30) {
    const key = `disc_${randomBytes(32).toString('base64url')}`;
    const id = randomUUID();
    this.db.prepare('INSERT INTO keys(id,hash,label,owner,expires,created) VALUES(?,?,?,?,?,?)').run(id, hash(key), label, Number(owner), days === null ? null : Date.now() + days * 86400000, Date.now());
    return { id, key, label };
  }
  keys() { return this.db.prepare('SELECT id,label,owner,expires,revoked,created FROM keys ORDER BY created DESC').all(); }
  revoke(id: string) { return this.db.prepare('UPDATE keys SET revoked=1 WHERE id=? AND owner=0').run(id).changes > 0; }
  login(key: string) {
    const row = this.db.prepare('SELECT id,label,owner FROM keys WHERE hash=? AND revoked=0 AND (expires IS NULL OR expires>?)').get(hash(key), Date.now()) as { id: string; label: string; owner: number } | undefined;
    if (!row) return null;
    const token = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token), row.id, csrf, Date.now() + 8 * 3600000);
    return { token, csrf, actor: { id: row.id, label: row.label, owner: !!row.owner } };
  }
  session(token: string): { actor: Actor; csrf: string } | null {
    const row = this.db.prepare(`SELECT k.id,k.label,k.owner,s.csrf FROM sessions s JOIN keys k ON k.id=s.key_id WHERE s.hash=? AND s.expires>? AND k.revoked=0 AND (k.expires IS NULL OR k.expires>?)`).get(hash(token), Date.now(), Date.now()) as { id: string; label: string; owner: number; csrf: string } | undefined;
    return row ? { actor: { id: row.id, label: row.label, owner: !!row.owner }, csrf: row.csrf } : null;
  }
  logout(token: string) { this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash(token)); }
  audit(actor: Actor, action: string, target: string, reason: string, status = 'success') {
    this.db.prepare('INSERT INTO logs VALUES(?,?,?,?,?,?,?)').run(randomUUID(), Date.now(), `${actor.label} (${actor.id})`, action, target, reason, status);
  }
  logs() { return this.db.prepare('SELECT * FROM logs ORDER BY time DESC LIMIT 200').all(); }
  warnings(memberId: string) { return this.db.prepare("SELECT * FROM logs WHERE action='warn' AND status='success' AND target=? ORDER BY time DESC").all(memberId); }
  plan(plan: ResetPlan) { this.db.prepare('DELETE FROM plans WHERE CAST(json_extract(data,\'$.expiresAt\') AS INTEGER)<=?').run(Date.now()); this.db.prepare('INSERT INTO plans VALUES(?,?)').run(plan.id, JSON.stringify(plan)); }
  readPlan(id: string): ResetPlan | null { const row = this.db.prepare('SELECT data FROM plans WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  consumePlan(id: string) { this.db.prepare('DELETE FROM plans WHERE id=?').run(id); }
  saveJob(job: Job) { this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?)').run(job.id, JSON.stringify(job)); }
  jobs(): Job[] { return this.db.prepare('SELECT data FROM jobs ORDER BY rowid DESC LIMIT 20').all().map(row => JSON.parse(row.data as string)); }
  job(id: string): Job | null { const row = this.db.prepare('SELECT data FROM jobs WHERE id=?').get(id) as { data: string } | undefined; return row ? JSON.parse(row.data) : null; }
  close() { this.db.close(); }
}

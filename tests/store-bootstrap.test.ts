import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store.js';

test('bootstrap stores only the hash, signs in, and persists without replacing an owner', () => {
  const directory = mkdtempSync(join(tmpdir(), 'disc-bootstrap-'));
  const key = 'disc_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
  const hash = createHash('sha256').update(key).digest('hex');
  let db = new Store(directory);
  try {
    assert.equal(db.bootstrapOwner(hash), true);
    assert.equal(db.login(key)?.actor.owner, true);
    assert.equal(db.login('disc_wrongkey12345678901234567890'), null);
    assert.equal(db.keys().length, 1);
    const row = db.db.prepare('SELECT hash FROM keys').get()!;
    assert.equal(row.hash, hash);
    assert.notEqual(row.hash, key);
    db.close();
    db = new Store(directory);
    assert.equal(db.bootstrapOwner(createHash('sha256').update('replacement').digest('hex')), false);
    assert.equal(db.keys().length, 1);
    assert.equal(db.login(key)?.actor.owner, true);
    assert.equal(db.login('replacement'), null);
    assert.throws(() => db.bootstrapOwner('invalid'), /SHA-256/);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

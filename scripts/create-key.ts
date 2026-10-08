import { config } from '../src/config.js';
import { Store } from '../src/store.js';
const settings = config();
const store = new Store(settings.dataDir);
const label = process.argv.slice(2).join(' ') || 'Server owner';
if (store.keys().some(k => k.owner && !k.revoked) && !process.argv.includes('--additional')) {
  console.error('An owner key already exists. To create a recovery key, use key:create -- --additional <label>. Keep owner keys private.');
  store.close(); process.exit(1);
}
const issued = store.issueKey(label.replace('--additional', '').trim(), true, null);
console.log(`Owner key (shown only now): ${issued.key}\nUse it to sign in at the dashboard. Store it securely; do not commit or share it.`);
store.close();

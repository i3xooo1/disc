import { config } from './config.js';
import { Store } from './store.js';
import { DiscordGateway, DemoGateway } from './gateway.js';
import { createApp } from './app.js';

const settings = config();
const store = new Store(settings.dataDir);
if (process.env.BOOTSTRAP_OWNER_KEY_SHA256) store.bootstrapOwner(process.env.BOOTSTRAP_OWNER_KEY_SHA256);
const gateway = settings.demo ? new DemoGateway() : await DiscordGateway.connect(settings.token, settings.guildId);
if (!store.keys().some(k => k.owner && !k.revoked)) console.log('Create your owner access key in another terminal: npm run key:create -- "Server owner"');
const app = createApp(store, gateway, settings);
const server = app.listen(settings.port, settings.host, () => console.log(`Disc Control listening on ${settings.host}:${settings.port} (${settings.demo ? 'demo — no Discord actions' : 'live'})`));
let stopping = false;
async function shutdown() {
  if (stopping) return; stopping = true;
  server.close(async () => { await app.locals.reset.stop(); await gateway.close(); store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);

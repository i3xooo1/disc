import 'dotenv/config';
import { resolve } from 'node:path';
export function config() {
  const demo = process.env.DEMO_MODE === 'true';
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '127.0.0.1';
  const origin = process.env.PUBLIC_ORIGIN || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${port}`);
  const proxy = Number(process.env.TRUST_PROXY || 0);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!Number.isInteger(proxy) || proxy < 0) throw new Error('Invalid TRUST_PROXY');
  const url = new URL(origin);
  if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol)) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a trailing slash');
  if (!demo && (!process.env.DISCORD_TOKEN || !process.env.DISCORD_GUILD_ID)) throw new Error('Set DISCORD_TOKEN and DISCORD_GUILD_ID, or set DEMO_MODE=true for the safe demo');
  if (!demo && !/^\d{17,20}$/.test(process.env.DISCORD_GUILD_ID!)) throw new Error('DISCORD_GUILD_ID must be a Discord server ID');
  if (!demo && url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('A remote dashboard requires an HTTPS PUBLIC_ORIGIN');
  return { demo, port, host, origin, proxy, secure: url.protocol === 'https:', dataDir: resolve(process.env.DATA_DIR || '.data', demo ? 'demo' : `live-${process.env.DISCORD_GUILD_ID}`), token: process.env.DISCORD_TOKEN || '', guildId: process.env.DISCORD_GUILD_ID || '' };
}

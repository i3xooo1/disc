import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';

function withEnvironment(values:Record<string,string|undefined>,run:()=>void) {
  const before=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  try {
    for(const [key,value] of Object.entries(values)) if(value===undefined) delete process.env[key];else process.env[key]=value;
    run();
  } finally {
    for(const [key,value] of Object.entries(before)) if(value===undefined) delete process.env[key];else process.env[key]=value;
  }
}

test('Railway assigned port and public domain produce secure HTTPS configuration',()=>{
  withEnvironment({DEMO_MODE:'true',PORT:'8123',HOST:'0.0.0.0',TRUST_PROXY:'1',DATA_DIR:'/tmp/railway-data',PUBLIC_ORIGIN:undefined,RAILWAY_PUBLIC_DOMAIN:'disc-control-production.up.railway.app'},()=>{
    const settings=config();
    assert.equal(settings.origin,'https://disc-control-production.up.railway.app');
    assert.equal(settings.secure,true);assert.equal(settings.port,8123);assert.equal(settings.host,'0.0.0.0');assert.equal(settings.proxy,1);assert.equal(settings.dataDir,resolve('/tmp/railway-data','demo'));
  });
});

test('explicit custom domain overrides Railway domain and local default remains usable',()=>{
  withEnvironment({DEMO_MODE:'true',PORT:'3000',PUBLIC_ORIGIN:'https://moderation.example.com',RAILWAY_PUBLIC_DOMAIN:'disc-control.up.railway.app'},()=>{
    assert.equal(config().origin,'https://moderation.example.com');
  });
  withEnvironment({DEMO_MODE:'true',PORT:'3000',PUBLIC_ORIGIN:undefined,RAILWAY_PUBLIC_DOMAIN:undefined},()=>{
    assert.equal(config().origin,'http://localhost:3000');assert.equal(config().secure,false);
  });
});


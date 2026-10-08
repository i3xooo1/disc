import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default function teardown() {
  const dir=process.env.DISC_E2E_DIR;
  if(dir?.startsWith(join(tmpdir(),'disc-browser-'))) rmSync(dir,{recursive:true,force:true});
}

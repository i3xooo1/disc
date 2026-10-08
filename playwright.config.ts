import { defineConfig } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DISC_E2E_DIR ||= mkdtempSync(join(tmpdir(),'disc-browser-'));
export default defineConfig({
  testDir:'./tests/browser',
  workers:1,
  fullyParallel:false,
  reporter:'list',
  outputDir:'.data/browser-results',
  globalTeardown:'./tests/browser/teardown.ts',
  use:{baseURL:'http://localhost:3100',headless:true,reducedMotion:'reduce',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined)},screenshot:'only-on-failure'},
  webServer:{command:'npm start',url:'http://localhost:3100/api/health',reuseExistingServer:false,env:{DEMO_MODE:'true',PORT:'3100',HOST:'127.0.0.1',PUBLIC_ORIGIN:'http://localhost:3100',DATA_DIR:process.env.DISC_E2E_DIR},timeout:30000}
});

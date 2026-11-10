import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',testMatch:'**/*.spec.ts',fullyParallel:false,workers:1,
  timeout:90000,expect:{timeout:20000},retries:0,
  reporter:process.env.CI?[['line'],['html',{outputFolder:'.data/e2e-report',open:'never'}]]:[['list']],
  outputDir:'.data/e2e-results',
  use:{baseURL:'http://127.0.0.1:5173',browserName:'chromium',headless:true,viewport:{width:1280,height:900},acceptDownloads:true,screenshot:'only-on-failure',trace:'off',video:'off'},
  webServer:{command:'npx tsx scripts/r10-e2e-server.ts',url:'http://127.0.0.1:5173',reuseExistingServer:false,timeout:90000},
});

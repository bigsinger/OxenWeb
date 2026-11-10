import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export interface Config {
  host: string;
  port: number;
  demo: boolean;
  demoFile: string;
  upstream?: string;
  upstreamToken?: string;
  token?: string;
  cliRoot: string;
  cliBin: string;
  cliTimeoutMs: number;
  secureCookies: boolean;
  namespaces: string[];
  projectRoot: string;
  allowedHosts: string[];
  /** Team deployments must never enable the implicit loopback owner identity. */
  teamMode: boolean;
}

function findProjectRoot(): string {
  let directory = fileURLToPath(new URL('.', import.meta.url));
  for (;;) {
    try { if ((JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: string }).name === 'oxen-web') return directory; }
    catch { /* continue through build output and workspace packages */ }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Cannot locate the Oxen Web project root.');
    directory = parent;
  }
}
export const projectRoot = findProjectRoot();

export function loadConfig(env = process.env): Config {
  const schema = z.object({
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DEMO_MODE: z.enum(['true', 'false']).default('false'),
    DEMO_DATA_FILE: z.string().default('.data/demo.json'),
    OXEN_SERVER_URL: z.string().url().refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }, 'Use an HTTP(S) server URL without inline credentials, query, or fragment.').optional(),
    OXEN_AUTH_TOKEN: z.string().optional(),
    BFF_TOKEN: z.string().min(16).optional(),
    BFF_TEAM_MODE: z.enum(['true','false']).default('false'),
    OXEN_CLI_ROOT: z.string().default('.data/clones'),
    OXEN_CLI_BIN: z.string().default('oxen'),
    OXEN_CLI_TIMEOUT_MS: z.coerce.number().int().min(100).max(3_600_000).default(120_000),
    SECURE_COOKIES: z.enum(['true', 'false']).default('false'),
    OXEN_NAMESPACES: z.string().default(''),
    BFF_ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1,::1'),
  }).parse(env);
  if (!['127.0.0.1', 'localhost', '::1'].includes(schema.HOST) && !schema.BFF_TOKEN) {
    throw new Error('BFF_TOKEN (at least 16 characters) is required when binding a non-loopback interface.');
  }
  if(schema.BFF_TEAM_MODE==='true'&&!schema.BFF_TOKEN)throw new Error('BFF_TOKEN is required in BFF_TEAM_MODE; implicit local owner access is disabled.');
  return {
    host: schema.HOST, port: schema.PORT, demo: schema.DEMO_MODE === 'true', demoFile: path.resolve(projectRoot, schema.DEMO_DATA_FILE),
    upstream: schema.OXEN_SERVER_URL?.replace(/\/$/, ''), upstreamToken: schema.OXEN_AUTH_TOKEN,
    token: schema.BFF_TOKEN, cliRoot: path.resolve(projectRoot, schema.OXEN_CLI_ROOT), cliBin: schema.OXEN_CLI_BIN,
    cliTimeoutMs: schema.OXEN_CLI_TIMEOUT_MS, secureCookies: schema.SECURE_COOKIES === 'true',
    namespaces: schema.OXEN_NAMESPACES.split(',').map(s => s.trim()).filter(Boolean),
    projectRoot,
    allowedHosts: schema.BFF_ALLOWED_HOSTS.split(',').map(host => host.trim().toLowerCase().replace(/^\[|\]$/g, '')).filter(Boolean),
    teamMode:schema.BFF_TEAM_MODE==='true',
  };
}

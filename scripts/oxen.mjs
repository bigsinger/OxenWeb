import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { openSync, closeSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const infra = path.join(root, 'infra', 'oxen');
const version = '0.67.0';
const port = Number(process.env.OXEN_LOCAL_PORT ?? 3002);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('OXEN_LOCAL_PORT must be an integer from 1024 to 65535.');
const origin = `http://127.0.0.1:${port}`;
const distribution = process.env.OXEN_WSL_DISTRIBUTION ?? 'Ubuntu-24.04';
const windows = process.platform === 'win32';
const cli = path.join(infra, 'bin', windows ? 'oxen.exe' : 'oxen');
const configuration = path.join(infra, 'config', 'client');
const env = { ...process.env, OXEN_CONFIG_DIR: configuration, NO_COLOR: '1', CLICOLOR: '0' };
const projectId = createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);

async function prepare() {
  for (const directory of ['bin', 'downloads', 'data', 'logs', 'repos', 'config/client', 'config/server', 'run']) {
    await mkdir(path.join(infra, directory), { recursive: true });
  }
}
function run(binary, args, cwd = root, options = {}) {
  const result = spawnSync(binary, args, { cwd, env, encoding: 'utf8', windowsHide: true, shell: false, timeout: 180_000, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(binary)} ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
function linuxPath(value) {
  if (!windows) return value;
  if (!/^[A-Za-z]:[\\/]/.test(value)) throw new Error('WSL launcher requires an absolute drive path.');
  return `/mnt/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}`;
}
async function serverDataDirectory() {
  const pointer = path.join(infra, 'run', 'data-location.json');
  if (!windows) return path.join(infra, 'data');
  const nativeHome = run('wsl.exe', ['-d', distribution, '--exec', '/usr/bin/printenv', 'HOME']);
  if (!nativeHome.startsWith('/') || nativeHome.startsWith('/mnt/') || nativeHome.includes('\n') || nativeHome.includes('..')) throw new Error('WSL must have a native Linux home directory.');
  const nativeDataDirectory = `${nativeHome}/.local/share/oxen-web/${projectId}/data`;
  if (existsSync(pointer)) {
    const location = JSON.parse(await readFile(pointer, 'utf8'));
    if (location.projectId !== projectId || location.distribution !== distribution || location.nativeDataDirectory !== nativeDataDirectory) {
      throw new Error('The recorded native WSL data location does not match this checkout/distribution. Review infra/oxen/run/data-location.json before starting.');
    }
    run('wsl.exe', ['-d', distribution, '--exec', '/bin/mkdir', '-p', location.nativeDataDirectory]);
    return location.nativeDataDirectory;
  }
  const alreadyExists = spawnSync('wsl.exe', ['-d', distribution, '--exec', '/usr/bin/test', '-e', nativeDataDirectory], { encoding: 'utf8', windowsHide: true });
  if (alreadyExists.status === 0) throw new Error(`Native data exists without a managed pointer; refusing to overwrite it: ${nativeDataDirectory}`);
  if (alreadyExists.error || alreadyExists.status !== 1) throw new Error('Could not check the native WSL data location.');
  run('wsl.exe', ['-d', distribution, '--exec', '/bin/mkdir', '-p', nativeDataDirectory]);
  // Copy only after stopping the server. Keep the original DrvFS data untouched.
  // Materialize sparse files so the upstream tar builder emits ordinary entries.
  run('wsl.exe', ['-d', distribution, '--exec', '/bin/cp', '--archive', '--sparse=never', '--reflink=never', `${linuxPath(path.join(infra, 'data'))}/.`, nativeDataDirectory]);
  const location = { projectId, distribution, nativeDataDirectory, migratedFrom: path.join(infra, 'data'), migratedAt: new Date().toISOString(), originalRetained: true };
  await writeFile(pointer, `${JSON.stringify(location, null, 2)}\n`);
  console.log(`Oxen server data uses native WSL storage: ${nativeDataDirectory}. Original project data retained.`);
  return nativeDataDirectory;
}
async function health() {
  try {
    const response = await fetch(`${origin}/api/version`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return undefined;
    const status = await response.json();
    return status?.status === 'success' && typeof status.oxen_version === 'string' ? status : undefined;
  } catch { return undefined; }
}
async function install() {
  if (await health()) throw new Error('Stop the managed Oxen server before replacing its binaries (npm run oxen:stop).');
  const releaseManifest = JSON.parse(await readFile(path.join(infra, 'release.json'), 'utf8'));
  const release = `https://github.com/Oxen-AI/Oxen/releases/download/v${version}`;
  const artifacts = windows
    ? ['oxen-windows-x86_64.exe.zip', 'oxen-server-linux-x86_64.tar.gz']
    : ['oxen-linux-x86_64.tar.gz', 'oxen-server-linux-x86_64.tar.gz'];
  const records = [];
  for (const name of artifacts) {
    const target = path.join(infra, 'downloads', name);
    if (!existsSync(target)) {
      console.log(`Downloading official ${name}…`);
      const response = await fetch(`${release}/${name}`);
      if (!response.ok) throw new Error(`Official download failed (${response.status}).`);
      await writeFile(target, Buffer.from(await response.arrayBuffer()));
    }
    const bytes = await readFile(target);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (releaseManifest.artifacts[name] && sha256 !== releaseManifest.artifacts[name]) throw new Error(`Pinned release checksum mismatch: ${name}`);
    records.push({ name, url: `${release}/${name}`, sha256 });
    run('tar', ['-xf', target, '-C', path.join(infra, 'bin')]);
  }
  const cliVersion = run(cli, ['--version']);
  if (cliVersion !== `oxen ${version}`) throw new Error(`Unexpected CLI version: ${cliVersion}`);
  const serverVersion = windows
    ? run('wsl.exe', ['-d', distribution, '--exec', linuxPath(path.join(infra, 'bin', 'oxen-server')), '--version'])
    : run(path.join(infra, 'bin', 'oxen-server'), ['--version']);
  if (serverVersion !== `oxen-server ${version}`) throw new Error(`Unexpected server version: ${serverVersion}`);
  await writeFile(path.join(infra, 'run', 'installed.json'), `${JSON.stringify({ version, cliVersion, serverVersion, records }, null, 2)}\n`);
  console.log(`${cliVersion}; ${serverVersion}. Binaries remain inside infra/oxen/bin.`);
}
async function start() {
  const existing = await health();
  if (existing) {
    if (existing.oxen_version !== version) throw new Error(`An Oxen ${existing.oxen_version} server already occupies ${origin}; this project requires ${version}.`);
    const stateFile = path.join(infra, 'run', 'server.json');
    const managed = existsSync(stateFile) ? JSON.parse(await readFile(stateFile, 'utf8')) : undefined;
    if (managed?.projectId !== projectId || managed?.origin !== origin) throw new Error(`An unmanaged Oxen server occupies ${origin}; refusing to adopt it or seed its data.`);
    console.log(`Oxen already responds at ${origin}: ${JSON.stringify(existing)}`); return;
  }
  const pidFile = path.join(infra, 'run', 'server.pid');
  const server = path.join(infra, 'bin', 'oxen-server');
  if (!existsSync(server)) throw new Error('Run npm run oxen:install first.');
  const syncDirectory = await serverDataDirectory();
  const serverEnv = {
    SYNC_DIR: windows ? syncDirectory : linuxPath(syncDirectory),
    OXEN_CONFIG_DIR: linuxPath(path.join(infra, 'config', 'server')),
    OXEN_LOCAL_PID_FILE: linuxPath(pidFile),
    OXEN_SERVER_BIN: linuxPath(server),
    RUST_LOG: 'info',
  };
  const output = openSync(path.join(infra, 'logs', 'server.log'), 'a');
  const error = openSync(path.join(infra, 'logs', 'server-error.log'), 'a');
  const command = windows ? 'wsl.exe' : '/usr/bin/env';
  const args = [
    ...(windows ? ['-d', distribution, '--exec', '/usr/bin/env'] : []),
    ...Object.entries(serverEnv).map(([key, value]) => `${key}=${value}`),
    '/bin/sh', linuxPath(path.join(infra, 'start-server.sh')), String(port),
  ];
  const child = spawn(command, args, { cwd: infra, detached: true, windowsHide: true, shell: false, stdio: ['ignore', output, error] });
  child.on('error', (failure) => { console.error(failure.message); process.exitCode = 1; });
  child.unref();
  closeSync(output); closeSync(error);
  for (let count = 0; count < 30; count++) {
    const status = await health();
    if (status) {
      if (status.oxen_version !== version) throw new Error(`Unexpected Oxen version at ${origin}: ${status.oxen_version}`);
      await writeFile(path.join(infra, 'run', 'server.json'), `${JSON.stringify({ version, origin, port, distribution: windows ? distribution : null, launcherPid: child.pid, pidFile, syncDirectory, projectId }, null, 2)}\n`);
      console.log(`Oxen ${version} is ready at ${origin} (loopback only).`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Oxen did not become healthy. Inspect ${path.join(infra, 'logs', 'server-error.log')}.`);
}
async function stop() {
  const pidFile = path.join(infra, 'run', 'server.pid');
  if (!existsSync(pidFile)) { console.log('No managed Oxen PID is recorded.'); return; }
  const pid = (await readFile(pidFile, 'utf8')).trim();
  if (!/^[1-9]\d*$/.test(pid)) throw new Error('Invalid recorded PID; refusing to signal a process.');
  const prefix = windows ? ['-d', distribution, '--exec'] : [];
  const binary = windows ? 'wsl.exe' : 'readlink';
  const args = windows ? [...prefix, '/usr/bin/readlink', `/proc/${pid}/exe`] : [`/proc/${pid}/exe`];
  const executable = run(binary, args);
  if (executable !== linuxPath(path.join(infra, 'bin', 'oxen-server'))) throw new Error('Recorded PID no longer belongs to this project’s Oxen server; refusing to stop it.');
  if (windows) run('wsl.exe', [...prefix, '/bin/kill', '-TERM', pid]);
  else process.kill(Number(pid), 'SIGTERM');
  console.log(`Stopped managed Oxen server (${pid}).`);
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function png() {
  const width = 640; const height = 400;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * (width * 3 + 1) + 1 + x * 3;
    const ridge = 190 + Math.sin(x / 95) * 45 + Math.sin(x / 37) * 12;
    const sky = y < ridge;
    rows[index] = sky ? 170 + Math.floor(y / 8) : 51 + Math.floor(y / 10);
    rows[index + 1] = sky ? 206 + Math.floor(y / 20) : 91 + Math.floor(y / 9);
    rows[index + 2] = sky ? 225 : 77 + Math.floor(y / 13);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const prefix = Buffer.alloc(4); prefix.writeUInt32BE(data.length);
    const suffix = Buffer.alloc(4); suffix.writeUInt32BE(crc32(body));
    return Buffer.concat([prefix, body, suffix]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function pdf() {
  const stream = 'BT /F1 24 Tf 60 740 Td (Oxen Visual Search Dataset) Tj 0 -44 Td /F1 12 Tf (A versioned multimodal dataset for local integration testing.) Tj 0 -24 Td (License: CC0 - generated sample data.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}
async function seed() {
  const status = await health();
  if (!status) throw new Error('Local Oxen is unavailable; run npm run oxen:start.');
  if (status.oxen_version !== version) throw new Error(`Seed requires Oxen ${version}, but the service reports ${status.oxen_version}.`);
  if (!existsSync(cli)) throw new Error('Run npm run oxen:install first.');
  const repo = path.join(infra, 'repos', 'local', 'visual-search');
  const writeLocalSettings = async () => {
    const settings = [
      'DEMO_MODE=false', `OXEN_SERVER_URL=${origin}`, 'OXEN_NAMESPACES=local',
      `OXEN_CLI_BIN=${cli}`, `OXEN_CLI_ROOT=${path.join(infra, 'repos')}`,
      `OXEN_CONFIG_DIR=${configuration}`, 'HOST=127.0.0.1', 'PORT=3001',
    ].join('\n');
    await writeFile(path.join(infra, 'local.env'), `${settings}\n`);
  };
  if (existsSync(path.join(repo, '.oxen'))) {
    await writeLocalSettings();
    console.log(`Seed checkout already exists: ${repo}. Refreshed BFF settings without changing repository data.`);
    return;
  }
  await mkdir(path.join(repo, 'images'), { recursive: true });
  await mkdir(path.join(repo, 'data'), { recursive: true });
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'README.md'), '# Visual Search\n\nA local multimodal Oxen repository for integration testing.\n\nBrowse `data/labels.csv` for linked images, preview `images/alpine.png`, and open `docs/dataset-card.pdf`.\n\nAll files are generated sample data (CC0).\n');
  await writeFile(path.join(repo, 'images', 'alpine.png'), png());
  await writeFile(path.join(repo, 'docs', 'dataset-card.pdf'), pdf());
  await writeFile(path.join(repo, 'data', 'labels.csv'), 'id,image,caption,label,confidence,split\n1,images/alpine.png,"Green alpine hills beneath a blue sky",landscape,0.98,train\n2,images/alpine.png,"A mountain ridge at midday",landscape,0.91,validation\n3,images/alpine.png,"A peaceful valley with rolling hills",nature,0.87,train\n');
  await writeFile(path.join(repo, 'dataset.json'), `${JSON.stringify({ name: 'Visual Search', license: 'CC0', modalities: ['image', 'text', 'table', 'pdf'], annotationFile: 'data/labels.csv' }, null, 2)}\n`);
  console.log(run(cli, ['config', '--name', 'Local Developer', '--email', 'developer@localhost']));
  console.log(run(cli, ['init'], repo));
  console.log(run(cli, ['create-remote', '--name', 'local/visual-search', '--host', `127.0.0.1:${port}`, '--scheme', 'http'], repo));
  console.log(run(cli, ['config', '--set-remote', 'origin', `${origin}/local/visual-search`], repo));
  console.log(run(cli, ['add', '.'], repo));
  console.log(run(cli, ['commit', '-m', 'Add multimodal visual search dataset'], repo));
  console.log(run(cli, ['push', 'origin', 'main'], repo));
  await writeFile(path.join(repo, 'data', 'labels.csv'), 'id,image,caption,label,confidence,split\n1,images/alpine.png,"Green alpine hills beneath a blue sky",landscape,0.98,train\n2,images/alpine.png,"A mountain ridge at midday",landscape,0.94,validation\n3,images/alpine.png,"A peaceful valley with rolling hills",nature,0.87,train\n');
  console.log(run(cli, ['add', 'data/labels.csv'], repo));
  console.log(run(cli, ['commit', '-m', 'Review validation confidence scores'], repo));
  console.log(run(cli, ['push', 'origin', 'main'], repo));
  await writeLocalSettings();
  console.log(`Seeded local/visual-search. BFF settings: ${path.join(infra, 'local.env')}`);
}

await prepare();
const action = process.argv[2] ?? 'status';
if (action === 'install') await install();
else if (action === 'start') await start();
else if (action === 'stop') await stop();
else if (action === 'seed') await seed();
else if (action === 'status') { const status = await health(); const ready = status?.oxen_version === version; console.log(JSON.stringify({ ready, origin, expectedVersion: version, status: status ?? null }, null, 2)); if (!ready) process.exitCode = 1; }
else throw new Error('Usage: node scripts/oxen.mjs install|start|stop|seed|status');

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config, ensureDataDir } from './config.js';
import { getLocalIPv4s } from './ip.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function pfxFile() {
  return path.join(config.dataDir, 'tls', 'server.pfx');
}

function passFile() {
  return pfxFile() + '.txt';
}

function readPassphrase() {
  return fs.readFileSync(passFile(), 'utf8').trim();
}

function isUsablePfx() {
  return fs.existsSync(pfxFile()) && fs.statSync(pfxFile()).size > 500;
}

// Si RCH_TLS es false no hay TLS. Si ya existe un .pfx válido (con su
// passphrase) lo reutiliza; si no, genera el certificado autofirmado.
export function getTlsOptions() {
  if (!config.tls) return null;
  if (isUsablePfx() && fs.existsSync(passFile())) {
    return { pfx: fs.readFileSync(pfxFile()), passphrase: readPassphrase() };
  }
  ensureTlsCert();
  return { pfx: fs.readFileSync(pfxFile()), passphrase: readPassphrase() };
}

export function ensureTlsCert() {
  ensureDataDir();
  const dir = path.dirname(pfxFile());
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(pfxFile(), { force: true });
  fs.rmSync(passFile(), { force: true });

  const ips = getLocalIPv4s().map((i) => i.address);
  const san = ['DNS=localhost', ...ips.map((i) => `IPAddress=${i}`)].join('&');
  const passphrase = crypto.randomBytes(24).toString('base64url');

  const ps = `
$cert = New-SelfSignedCertificate -Subject "CN=Remote Control Hub" -TextExtension @("2.5.29.17={text}${san}") -CertStoreLocation Cert:\\CurrentUser\\My -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddYears(5)
$pwd = ConvertTo-SecureString -String '${passphrase}' -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath '${pfxFile()}' -Password $pwd -Force
Remove-Item -Path "Cert:\\CurrentUser\\My\\$($cert.Thumbprint)" -Force
`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.status !== 0 || !isUsablePfx()) {
    throw new Error(`no se pudo generar el certificado TLS: ${(r.stderr || r.stdout || '').trim()}`);
  }
  fs.writeFileSync(passFile(), passphrase, 'utf8');
  return getTlsOptions();
}
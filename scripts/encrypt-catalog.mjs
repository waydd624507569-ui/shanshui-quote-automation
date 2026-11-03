import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourcePath = path.join(root, 'src/data/catalog.json');
const outputPath = path.join(root, 'public/data/catalog.enc.json');
const passwordPath = process.env.CATALOG_PASSPHRASE_FILE || path.join(os.homedir(), '.config/product-quote/customer-password');
const passphrase = process.env.CATALOG_PASSPHRASE || fs.readFileSync(passwordPath, 'utf8').trim();

if (!passphrase) {
  throw new Error('客户访问码为空');
}

const catalog = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const iterations = 250_000;
const keyMaterial = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(passphrase),
  'PBKDF2',
  false,
  ['deriveKey'],
);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt'],
);
const encrypted = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  key,
  new TextEncoder().encode(JSON.stringify(catalog)),
);

const envelope = {
  schemaVersion: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: salt.toString('base64') },
  cipher: { name: 'AES-GCM', iv: iv.toString('base64') },
  payload: Buffer.from(encrypted).toString('base64'),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(envelope));
console.log(`已加密 ${catalog.items.length} 条报价：${outputPath}`);

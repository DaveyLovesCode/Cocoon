#!/usr/bin/env node
const crypto = require('crypto');
const fs = require('fs');

const LOG_SALT = 'cocoon-logs-v1';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node decrypt-logs.js <logfile.txt>');
  process.exit(1);
}

const encrypted = fs.readFileSync(file, 'utf8').trim();
const combined = Buffer.from(encrypted, 'base64');
const iv = combined.subarray(0, 12);
const ciphertext = combined.subarray(12);

const keyHash = crypto.createHash('sha256').update(LOG_SALT).digest();
const decipher = crypto.createDecipheriv('aes-256-gcm', keyHash, iv);
decipher.setAuthTag(ciphertext.subarray(-16));

const decrypted = Buffer.concat([
  decipher.update(ciphertext.subarray(0, -16)),
  decipher.final()
]);

const logs = JSON.parse(decrypted.toString('utf8'));
console.log(JSON.stringify(logs, null, 2));

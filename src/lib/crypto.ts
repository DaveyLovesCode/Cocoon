/**
 * API Key Encryption
 * - Encrypts API keys at rest using Web Crypto API
 * - Derives key from extension ID + static salt
 * - AES-GCM encryption with random IV per operation
 */

const SALT = 'cocoon-api-key-v1'; // Static salt for key derivation

function uint8ToBase64(bytes: Uint8Array): string {
  // Avoid `String.fromCharCode(...bytes)` which can overflow the stack on large arrays.
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getDerivedKey(): Promise<CryptoKey> {
  const keyMaterial = `${browser.runtime.id}-${SALT}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(keyMaterial);

  // Import as raw key material
  const importedKey = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', keyData),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  return importedKey;
}

export async function encryptApiKey(plaintext: string): Promise<string> {
  if (!plaintext) return '';

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const key = await getDerivedKey();

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // Combine IV + ciphertext, encode as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return uint8ToBase64(combined);
}

export async function decryptApiKey(encrypted: string): Promise<string> {
  if (!encrypted) return '';

  // Legacy migration: if key starts with "sk-", it's unencrypted - re-encrypt it
  if (encrypted.startsWith('sk-')) {
    const reencrypted = await encryptApiKey(encrypted);
    await browser.storage.sync.set({ apiKey: reencrypted });
    return encrypted;
  }

  try {
    // Decode base64
    const combined = base64ToUint8(encrypted);

    // Extract IV and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const key = await getDerivedKey();

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (e) {
    console.error('Failed to decrypt API key:', e);
    return '';
  }
}

export function maskApiKey(key: string): string {
  if (!key || key.length < 4) return '••••••••';
  return '••••••••' + key.slice(-4);
}

/**
 * Log Encryption
 * - Static key (no extension ID) so you can decrypt any user's logs
 * - Different salt from API key encryption
 */
const LOG_SALT = 'cocoon-logs-v1';

async function getLogKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(LOG_SALT);

  return await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', keyData),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptLogs(plaintext: string): Promise<string> {
  if (!plaintext) return '';

  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const key = await getLogKey();

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return uint8ToBase64(combined);
}

export async function decryptLogs(encrypted: string): Promise<string> {
  if (!encrypted) return '';

  try {
    const combined = base64ToUint8(encrypted);
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const key = await getLogKey();

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error('Failed to decrypt logs:', e);
    return '';
  }
}

/**
 * Cocoon Logger - Stores encrypted logs with rotation
 * - Two chunks, rotates when current exceeds 50MB
 * - Encrypted at rest, console output dev-only
 */

import { encryptLogs, decryptLogs } from './crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  data?: any;
  source: string;
}

const MAX_CHUNK_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_ENTRIES = 2000; // Prevent stack overflow on JSON.stringify
const CHUNK_KEYS = ['cocoonLogs_0', 'cocoonLogs_1'] as const;
const META_KEY = 'cocoonLogsMeta';

// === Log Hub Integration (dev only) ===
declare const __LOG_HUB_PORT__: string | null;
const logHubPort = __LOG_HUB_PORT__ ? parseInt(__LOG_HUB_PORT__) : null;

// Detect if we're in a content script (not service worker)
const isContentScript = typeof window !== 'undefined' && !!window.location?.href?.startsWith('http');
const isDev = import.meta.env.MODE === 'development';

function postToLogHub(entry: LogEntry) {
  if (!logHubPort) return;

  const message = entry.data
    ? `${entry.message} ${typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data)}`
    : entry.message;

  const payload = {
    project: 'cocoon',
    env: 'dev',
    scope: entry.source,
    level: entry.level === 'warn' ? 'info' : entry.level,
    message
  };

  // Content scripts route through service worker to avoid Private Network Access restrictions
  if (isContentScript) {
    browser.runtime.sendMessage({ type: 'LOG_HUB', payload }).catch(() => {});
  } else {
    fetch(`http://127.0.0.1:${logHubPort}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});
  }
}

type LogMeta = { current: 0 | 1 };

// Global write queue to serialize storage writes
let writeQueue: Promise<void> = Promise.resolve();
let pendingEntries: LogEntry[] = [];
let flushScheduled = false;

async function getMeta(): Promise<LogMeta> {
  const result = await browser.storage.local.get([META_KEY]) as { [META_KEY]?: LogMeta };
  return result[META_KEY] || { current: 0 };
}

async function decryptChunk(key: string): Promise<LogEntry[]> {
  const result = await browser.storage.local.get([key]) as Record<string, string | LogEntry[] | undefined>;
  const data = result[key];
  if (!data) return [];

  // Handle migration from old unencrypted format
  if (Array.isArray(data)) {
    return data as LogEntry[];
  }

  const decrypted = await decryptLogs(data);
  if (!decrypted) return [];

  try {
    return JSON.parse(decrypted);
  } catch {
    return [];
  }
}

async function loadAllLogs(): Promise<LogEntry[]> {
  const [chunk0, chunk1] = await Promise.all([
    decryptChunk(CHUNK_KEYS[0]),
    decryptChunk(CHUNK_KEYS[1]),
  ]);

  // Combine and sort by timestamp
  return [...chunk0, ...chunk1].sort((a, b) => a.timestamp - b.timestamp);
}

async function migrateOldLogs(): Promise<void> {
  const result = await browser.storage.local.get(['cocoonLogs']) as { cocoonLogs?: string | LogEntry[] };
  if (!result.cocoonLogs) return;

  let logs: LogEntry[] = [];
  if (Array.isArray(result.cocoonLogs)) {
    logs = result.cocoonLogs;
  } else if (typeof result.cocoonLogs === 'string' && result.cocoonLogs) {
    const decrypted = await decryptLogs(result.cocoonLogs);
    if (decrypted) {
      try {
        logs = JSON.parse(decrypted);
      } catch { /* ignore */ }
    }
  }

  if (logs.length > 0) {
    const encrypted = await encryptLogs(JSON.stringify(logs));
    await browser.storage.local.set({
      [CHUNK_KEYS[0]]: encrypted,
      [META_KEY]: { current: 0 },
    });
  }

  // Remove old key
  await browser.storage.local.remove('cocoonLogs');
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;

  setTimeout(() => {
    flushScheduled = false;
    if (pendingEntries.length === 0) return;

    const entries = pendingEntries;
    pendingEntries = [];

    writeQueue = writeQueue.then(async () => {
      try {
        // One-time migration
        await migrateOldLogs();

        const meta = await getMeta();
        const currentKey = CHUNK_KEYS[meta.current];
        const logs = await decryptChunk(currentKey);

        logs.push(...entries);

        // Trim oldest entries to prevent stack overflow on stringify
        if (logs.length > MAX_ENTRIES) {
          logs.splice(0, logs.length - MAX_ENTRIES);
        }

        const json = JSON.stringify(logs);
        const encrypted = await encryptLogs(json);

        // Check if rotation needed (estimate size from JSON length)
        if (json.length > MAX_CHUNK_SIZE) {
          // Rotate: switch to other chunk, clear it
          const nextIndex = meta.current === 0 ? 1 : 0;
          const nextKey = CHUNK_KEYS[nextIndex];

          // Start fresh in new chunk with just the new entries
          const freshEncrypted = await encryptLogs(JSON.stringify(entries));
          await browser.storage.local.set({
            [nextKey]: freshEncrypted,
            [META_KEY]: { current: nextIndex },
          });
        } else {
          await browser.storage.local.set({ [currentKey]: encrypted });
        }
      } catch (e) {
        console.warn('[Cocoon] Failed to store logs:', e);
      }
    });
  }, 500);
}

class Logger {
  private source: string;

  constructor(source: string) {
    this.source = source;
  }

  debug(message: string, data?: any) {
    this.log('debug', message, data);
  }

  info(message: string, data?: any) {
    this.log('info', message, data);
  }

  warn(message: string, data?: any) {
    this.log('warn', message, data);
  }

  error(message: string, data?: any) {
    this.log('error', message, data);
  }

  private log(level: LogLevel, message: string, data?: any) {
    if (!isDev && level === 'debug') return;

    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      level,
      message,
      data: data !== undefined ? this.serialize(data) : undefined,
      source: this.source,
    };

    if (isDev) {
      const prefix = `[Cocoon:${this.source}]`;
      const consoleFn = level === 'error' ? console.error
                      : level === 'warn' ? console.warn
                      : level === 'debug' ? console.debug
                      : console.log;

      if (data !== undefined) {
        consoleFn(prefix, message, data);
      } else {
        consoleFn(prefix, message);
      }
    }

    pendingEntries.push(entry);
    scheduleFlush();

    // Post to Log Hub in dev mode
    if (isDev) {
      postToLogHub(entry);
    }
  }

  private serialize(data: any): any {
    if (data === null || data === undefined) return data;
    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return data;
    }
    if (data instanceof Error) {
      return { message: data.message, stack: data.stack };
    }
    try {
      const str = JSON.stringify(data);
      if (str.length > 10000) {
        return str.substring(0, 10000) + '... [truncated]';
      }
      return JSON.parse(str);
    } catch {
      return String(data);
    }
  }
}

export function createLogger(source: string): Logger {
  return new Logger(source);
}

export async function getLogs(): Promise<LogEntry[]> {
  await migrateOldLogs();
  return loadAllLogs();
}

export async function getEncryptedLogs(): Promise<string> {
  await migrateOldLogs();
  const logs = await loadAllLogs();
  if (logs.length === 0) return '';
  return encryptLogs(JSON.stringify(logs));
}

export async function clearLogs(): Promise<void> {
  await browser.storage.local.set({
    [CHUNK_KEYS[0]]: '',
    [CHUNK_KEYS[1]]: '',
    [META_KEY]: { current: 0 },
  });
}

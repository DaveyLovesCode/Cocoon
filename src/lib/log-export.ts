import initSqlJs, { type Database } from 'sql.js';
import { getLogs } from './logger';

let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

async function getSql() {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file) => `https://sql.js.org/dist/${file}`
    });
  }
  return SQL;
}

export async function exportLogsAsDb(): Promise<Blob> {
  const sql = await getSql();
  const db = new sql.Database();

  db.run(`
    CREATE TABLE logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      project TEXT NOT NULL,
      scope TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    )
  `);

  const logs = await getLogs();
  const stmt = db.prepare(
    'INSERT INTO logs (timestamp, project, scope, level, message) VALUES (?, ?, ?, ?, ?)'
  );

  for (const log of logs) {
    const timestamp = new Date(log.timestamp).toISOString();
    const message = log.data
      ? `${log.message} ${typeof log.data === 'string' ? log.data : JSON.stringify(log.data)}`
      : log.message;
    stmt.run([timestamp, 'cocoon', log.source, log.level, message]);
  }
  stmt.free();

  const data = db.export();
  db.close();

  return new Blob([data], { type: 'application/x-sqlite3' });
}

export async function downloadLogsDb() {
  const blob = await exportLogsAsDb();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cocoon-logs-${Date.now()}.db`;
  a.click();
  URL.revokeObjectURL(url);
}

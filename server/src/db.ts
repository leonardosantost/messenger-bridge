import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'bridge.sqlite3'));

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    thread_id TEXT PRIMARY KEY,
    contact_identifier TEXT NOT NULL,
    conversation_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

export interface ThreadMapping {
  threadId: string;
  contactIdentifier: string;
  conversationId: number;
}

export function getThreadMapping(threadId: string): ThreadMapping | undefined {
  const row = db
    .prepare('SELECT thread_id, contact_identifier, conversation_id FROM threads WHERE thread_id = ?')
    .get(threadId) as { thread_id: string; contact_identifier: string; conversation_id: number } | undefined;
  if (!row) return undefined;
  return {
    threadId: row.thread_id,
    contactIdentifier: row.contact_identifier,
    conversationId: row.conversation_id,
  };
}

export function getThreadMappingByConversationId(conversationId: number): ThreadMapping | undefined {
  const row = db
    .prepare('SELECT thread_id, contact_identifier, conversation_id FROM threads WHERE conversation_id = ?')
    .get(conversationId) as { thread_id: string; contact_identifier: string; conversation_id: number } | undefined;
  if (!row) return undefined;
  return {
    threadId: row.thread_id,
    contactIdentifier: row.contact_identifier,
    conversationId: row.conversation_id,
  };
}

export function saveThreadMapping(mapping: ThreadMapping): void {
  db.prepare(
    `INSERT INTO threads (thread_id, contact_identifier, conversation_id)
     VALUES (@threadId, @contactIdentifier, @conversationId)
     ON CONFLICT(thread_id) DO UPDATE SET
       contact_identifier = excluded.contact_identifier,
       conversation_id = excluded.conversation_id`
  ).run(mapping);
}

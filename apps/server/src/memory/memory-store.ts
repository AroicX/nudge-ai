import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MemoryChatSchema,
  MemoryDocumentSchema,
  MemoryFactSchema,
  MemoryIdSchema,
  MemoryMessagesSchema,
  type MemoryChat,
  type MemoryDocument,
  type MemoryFact,
  type MemorySearchResult,
  type PersistedTurn,
} from '@nudge/contracts';
import { declaredProfileFacts } from './profile-facts';

export function defaultMemoryPath(env = process.env): string {
  const directory =
    env.NUDGE_DATA_DIR ||
    (process.platform === 'darwin'
      ? join(homedir(), 'Library', 'Application Support', 'Nudge')
      : join(homedir(), '.local', 'share', 'nudge'));
  return join(directory, 'nudge.sqlite');
}
export class MemoryError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
  }
}
const now = () => new Date().toISOString();

/** One local SQLite database is the authority for all panels. No network or model calls. */
export class MemoryStore {
  private readonly db: DatabaseSync;
  private readonly fullTextSearch: boolean;
  constructor(
    public readonly path: string = defaultMemoryPath(),
    options: { fullTextSearch?: boolean } = {},
  ) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      // Tighten the app directory, not its ancestors.
      chmodSync(dirname(path), 0o700);
      const fd = openSync(path, 'a', 0o600);
      closeSync(fd);
      chmodSync(path, 0o600);
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS deleted_chats(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS memory_preferences(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS deleted_documents(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, title TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, chatId TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE, role TEXT NOT NULL, text TEXT NOT NULL, createdAt TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS messages_chat ON messages(chatId, createdAt);
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, filename TEXT NOT NULL, text TEXT NOT NULL, source TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS facts(key TEXT PRIMARY KEY, value TEXT NOT NULL, source TEXT NOT NULL, updatedAt TEXT NOT NULL, messageId TEXT REFERENCES messages(id) ON DELETE CASCADE, documentId TEXT REFERENCES documents(id) ON DELETE CASCADE);
    `);
    const existing = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE name='memory_search'")
      .get();
    let supported = options.fullTextSearch !== false;
    if (supported) {
      try {
        this.db.exec(
          'CREATE VIRTUAL TABLE temp.nudge_fts_probe USING fts5(text); DROP TABLE temp.nudge_fts_probe;',
        );
      } catch (error) {
        if (!(error instanceof Error) || !/no such module: fts5/i.test(error.message)) {
          this.db.close();
          throw error;
        }
        supported = false;
      }
    }
    if (existing && String(existing.sql).includes('VIRTUAL TABLE') && !supported) {
      this.db.close();
      throw new MemoryError(
        'This database uses FTS5. Open it with a Node SQLite runtime that supports FTS5.',
        503,
      );
    }
    this.fullTextSearch = existing ? String(existing.sql).includes('VIRTUAL TABLE') : supported;
    if (this.fullTextSearch)
      this.db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memory_search USING fts5(kind UNINDEXED, id UNINDEXED, chatId UNINDEXED, title, text, source UNINDEXED, updatedAt UNINDEXED, tokenize='unicode61')",
      );
    else
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS memory_search(kind TEXT,id TEXT,chatId TEXT,title TEXT,text TEXT,source TEXT,updatedAt TEXT,PRIMARY KEY(kind,id))',
      );
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS message_search_delete AFTER DELETE ON messages BEGIN DELETE FROM memory_search WHERE kind='message' AND id=old.id; END;
      CREATE TRIGGER IF NOT EXISTS fact_search_delete AFTER DELETE ON facts BEGIN DELETE FROM memory_search WHERE kind='fact' AND id=old.key; END;
      CREATE TRIGGER IF NOT EXISTS document_search_delete AFTER DELETE ON documents BEGIN DELETE FROM memory_search WHERE kind='document' AND id=old.id; END;
    `);
  }
  close() {
    this.db.close();
  }
  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private index(
    kind: MemorySearchResult['kind'],
    id: string,
    chatId: string,
    title: string,
    text: string,
    source: string,
    updatedAt: string,
  ) {
    this.db.prepare('DELETE FROM memory_search WHERE kind=? AND id=?').run(kind, id);
    this.db
      .prepare(
        'INSERT INTO memory_search(kind,id,chatId,title,text,source,updatedAt) VALUES(?,?,?,?,?,?,?)',
      )
      .run(kind, id, chatId, title, text, source, updatedAt);
  }
  listChats(): MemoryChat[] {
    return this.db
      .prepare('SELECT * FROM chats ORDER BY updatedAt DESC, id LIMIT 1000')
      .all()
      .map((row) => MemoryChatSchema.parse(row));
  }
  getChat(id: string): MemoryChat {
    const row = this.db.prepare('SELECT * FROM chats WHERE id=?').get(id);
    if (!row) throw new MemoryError('Chat not found.', 404);
    return MemoryChatSchema.parse(row);
  }
  createChat(input: { id?: string | undefined; title?: string | undefined } = {}): MemoryChat {
    const timestamp = now();
    const chat = MemoryChatSchema.parse({
      id: input.id ?? randomUUID(),
      title: input.title?.trim() || 'New chat',
      createdAt: timestamp,
      updatedAt: timestamp,
      generation: 0,
    });
    if (this.db.prepare('SELECT id FROM deleted_chats WHERE id=?').get(chat.id))
      throw new MemoryError('This chat was deleted. Create a new chat.', 409);
    if (this.db.prepare('SELECT id FROM chats WHERE id=?').get(chat.id))
      return this.getChat(chat.id);
    this.db
      .prepare('INSERT INTO chats VALUES(?,?,?,?,?)')
      .run(chat.id, chat.title, timestamp, timestamp, 0);
    return chat;
  }
  renameChat(id: string, title: string) {
    this.getChat(id);
    const valid = MemoryChatSchema.shape.title.parse(title.trim());
    return this.transaction(() => {
      this.db.prepare('UPDATE chats SET title=?, updatedAt=? WHERE id=?').run(valid, now(), id);
      this.db
        .prepare("UPDATE memory_search SET title=? WHERE kind='message' AND chatId=?")
        .run(valid, id);
      return this.getChat(id);
    });
  }
  deleteChat(id: string) {
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO deleted_chats VALUES(?)').run(id);
      this.db.prepare('DELETE FROM chats WHERE id=?').run(id);
    });
  }
  clearChat(id: string) {
    return this.transaction(() => {
      this.getChat(id);
      this.db.prepare('DELETE FROM messages WHERE chatId=?').run(id);
      this.db
        .prepare('UPDATE chats SET generation=generation+1, updatedAt=? WHERE id=?')
        .run(now(), id);
      return this.getChat(id);
    });
  }
  listMessages(id: string): PersistedTurn[] {
    this.getChat(id);
    return this.db
      .prepare(
        'SELECT data FROM (SELECT rowid, data, createdAt FROM messages WHERE chatId=? ORDER BY createdAt DESC,rowid DESC LIMIT 500) ORDER BY createdAt,rowid',
      )
      .all(id)
      .map((row) => JSON.parse(String(row.data)) as PersistedTurn);
  }
  upsertMessages(id: string, messages: PersistedTurn[], generation: number): PersistedTurn[] {
    const input = MemoryMessagesSchema.parse({ messages, generation });
    return this.transaction(() => {
      const chat = this.getChat(id);
      if (chat.generation !== input.generation)
        throw new MemoryError('This chat was cleared. Reload it before saving.', 409);
      for (const message of input.messages) {
        const existing = this.db
          .prepare('SELECT chatId,role,text,data FROM messages WHERE id=?')
          .get(message.id);
        if (existing) {
          if (
            existing.chatId !== id ||
            existing.role !== message.role ||
            existing.text !== message.text
          )
            throw new MemoryError('Message identity and text cannot be replaced.', 409);
          const previous = JSON.parse(String(existing.data)) as PersistedTurn;
          // Immutable message text; delayed sources/progress may enrich the existing record.
          const merged = { ...previous, ...message, createdAt: previous.createdAt };
          if (!message.progress && previous.progress) merged.progress = previous.progress;
          const terminal = new Set(['completed', 'partially_completed', 'failed', 'cancelled']);
          if (
            previous.progress &&
            message.progress?.taskId === previous.progress.taskId &&
            terminal.has(previous.progress.status) &&
            !terminal.has(message.progress.status)
          )
            merged.progress = previous.progress;
          if (!message.sources.length && previous.sources.length) merged.sources = previous.sources;
          this.db
            .prepare('UPDATE messages SET data=? WHERE id=?')
            .run(JSON.stringify(merged), message.id);
          continue;
        }
        this.db
          .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
          .run(
            message.id,
            id,
            message.role,
            message.text,
            message.createdAt,
            JSON.stringify(message),
          );
        const source = `chat:${id}/message:${message.id}`;
        this.index('message', message.id, id, chat.title, message.text, source, message.createdAt);
        const preceding =
          message.role === 'user'
            ? this.db
                .prepare(
                  'SELECT role,text FROM messages WHERE chatId=? AND id<>? AND createdAt<=? ORDER BY createdAt DESC,rowid DESC LIMIT 1',
                )
                .get(id, message.id, message.createdAt)
            : undefined;
        if (message.role === 'user' && this.preferences().autoRemember)
          for (const fact of declaredProfileFacts(
            message.text,
            preceding?.role === 'assistant' ? String(preceding.text) : undefined,
          )) {
            const old = this.db
              .prepare('SELECT messageId,updatedAt FROM facts WHERE key=?')
              .get(fact.key);
            // Explicit profile edits outrank inferred declarations. Older imports never revert newer facts.
            if (old && (!old.messageId || String(old.updatedAt) > message.createdAt)) continue;
            this.writeFact(fact.key, fact.value, source, message.id, null, message.createdAt);
          }
      }
      this.db.prepare('UPDATE chats SET updatedAt=? WHERE id=?').run(now(), id);
      return this.listMessages(id);
    });
  }
  listFacts(): MemoryFact[] {
    return this.db
      .prepare('SELECT key,value,source,updatedAt FROM facts ORDER BY key LIMIT 500')
      .all()
      .map((row) => MemoryFactSchema.parse(row));
  }
  preferences(): { autoRemember: boolean; localDiagnostics: boolean } {
    const rows = this.db.prepare('SELECT key,value FROM memory_preferences').all();
    const values = Object.fromEntries(
      rows.map((row) => [String(row.key), Number(row.value) === 1]),
    );
    return {
      autoRemember: values.autoRemember ?? true,
      localDiagnostics: values.localDiagnostics ?? false,
    };
  }
  setPreferences(value: { autoRemember: boolean; localDiagnostics: boolean }) {
    const save = this.db.prepare(
      'INSERT INTO memory_preferences VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    );
    for (const [key, enabled] of Object.entries(value)) save.run(key, Number(enabled));
    return this.preferences();
  }
  private writeFact(
    key: string,
    value: string,
    source: string,
    messageId: string | null,
    documentId: string | null,
    timestamp = now(),
  ): MemoryFact {
    const fact = MemoryFactSchema.parse({ key, value, source, updatedAt: timestamp });
    this.db
      .prepare(
        'INSERT INTO facts VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, source=excluded.source, updatedAt=excluded.updatedAt, messageId=excluded.messageId, documentId=excluded.documentId',
      )
      .run(key, value, source, timestamp, messageId, documentId);
    this.index('fact', key, '', key.replaceAll('_', ' '), value, source, timestamp);
    return fact;
  }
  setFact(key: string, value: string, source = 'Profile edited by you'): MemoryFact {
    return this.transaction(() => this.writeFact(key, value, source, null, null));
  }
  deleteFact(key: string) {
    this.db.prepare('DELETE FROM facts WHERE key=?').run(key);
  }
  listDocuments(): MemoryDocument[] {
    return this.db
      .prepare('SELECT * FROM documents ORDER BY createdAt DESC LIMIT 100')
      .all()
      .map((row) => MemoryDocumentSchema.parse(row));
  }
  addDocument(input: { id?: string | undefined; filename: string; text: string }): MemoryDocument {
    const id = MemoryIdSchema.parse(input.id ?? randomUUID());
    const doc = MemoryDocumentSchema.parse({
      id,
      filename: input.filename,
      text: input.text,
      source: `document:${id}`,
      createdAt: now(),
    });
    return this.transaction(() => {
      if (this.db.prepare('SELECT id FROM deleted_documents WHERE id=?').get(id))
        throw new MemoryError('This document was deleted. Import it with a new identity.', 409);
      const existing = this.db.prepare('SELECT * FROM documents WHERE id=?').get(id);
      if (existing) {
        if (existing.filename !== doc.filename || existing.text !== doc.text)
          throw new MemoryError('Document identity cannot be replaced.', 409);
        return MemoryDocumentSchema.parse(existing);
      }
      this.db
        .prepare('INSERT INTO documents VALUES(?,?,?,?,?)')
        .run(doc.id, doc.filename, doc.text, doc.source, doc.createdAt);
      this.index('document', id, '', doc.filename, doc.text, doc.source, doc.createdAt);
      return doc;
    });
  }
  deleteDocument(id: string) {
    this.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO deleted_documents VALUES(?)').run(id);
      this.db.prepare('DELETE FROM documents WHERE id=?').run(id);
    });
  }
  search(query: string, limit = 12): MemorySearchResult[] {
    const stopWords = new Set(
      'what when where who why how did do does is are was were will would can could should have has had i my me we our you your the a an and or but of to in on for from with about that this it please tell remember recall know'.split(
        ' ',
      ),
    );
    const tokens = [...new Set(query.slice(0, 1000).match(/[\p{L}\p{N}_]{2,}/gu) ?? [])]
      .filter((token) => !stopWords.has(token.toLowerCase()))
      .slice(0, 16);
    if (!tokens.length) return [];
    const match = tokens.map((token) => `"${token}"`).join(' OR ');
    const boundedLimit = Math.min(30, Math.max(1, Math.floor(limit)));
    const rows = this.fullTextSearch
      ? this.db
          .prepare(
            "SELECT kind,id,chatId,title,snippet(memory_search,4,'','', ' … ',48) AS text,source,updatedAt FROM memory_search WHERE memory_search MATCH ? ORDER BY rank LIMIT ?",
          )
          .all(match, boundedLimit)
      : this.db
          .prepare(
            `SELECT kind,id,chatId,title,text,source,updatedAt FROM memory_search WHERE ${tokens.map(() => "(lower(title) LIKE ? ESCAPE '\\' OR lower(text) LIKE ? ESCAPE '\\')").join(' OR ')} ORDER BY updatedAt DESC LIMIT ?`,
          )
          .all(
            ...tokens.flatMap((token) => {
              const pattern = `%${token.toLowerCase().replaceAll('_', '\\_')}%`;
              return [pattern, pattern];
            }),
            boundedLimit,
          );
    return rows.map((row) => {
      const text = String(row.text);
      const matches = tokens
        .map((token) => text.toLowerCase().indexOf(token.toLowerCase()))
        .filter((index) => index >= 0);
      const start =
        this.fullTextSearch || !matches.length ? 0 : Math.max(0, Math.min(...matches) - 180);
      return {
        kind: row.kind as MemorySearchResult['kind'],
        id: String(row.id),
        ...(row.chatId ? { chatId: String(row.chatId) } : {}),
        title: String(row.title),
        text: text.slice(start, start + 1800),
        source: String(row.source),
        updatedAt: String(row.updatedAt),
      };
    });
  }
}

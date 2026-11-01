import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

/**
 * A minimal document store on top of Node's built-in SQLite.
 * Each app keeps its own database file in DATA_DIR. Good enough for a prototype; swap for Postgres later.
 */
export class DocStore {
  private db: DatabaseSync;

  constructor(name: string) {
    this.db = new DatabaseSync(path.join(config.dataDir, `${name}.db`));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS docs_by_collection ON docs (collection, updated_at);
    `);
  }

  put<T>(collection: string, id: string, doc: T): T {
    this.db
      .prepare(
        `INSERT INTO docs (collection, id, json, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
      )
      .run(collection, id, JSON.stringify(doc), new Date().toISOString());
    return doc;
  }

  get<T>(collection: string, id: string): T | undefined {
    const row = this.db.prepare(`SELECT json FROM docs WHERE collection = ? AND id = ?`).get(collection, id) as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  /** Read-modify-write helper. Returns the updated document, or undefined if it didn't exist. */
  update<T>(collection: string, id: string, fn: (doc: T) => T | undefined): T | undefined {
    const current = this.get<T>(collection, id);
    if (!current) return undefined;
    const next = (fn(current) ?? current) as T;
    return this.put(collection, id, next);
  }

  /** Newest first. The limit applies to the matching docs (after the filter), not to the rows scanned. */
  list<T>(collection: string, filter?: (doc: T) => boolean, limit = 500): T[] {
    if (!filter) {
      const rows = this.db
        .prepare(`SELECT json FROM docs WHERE collection = ? ORDER BY updated_at DESC LIMIT ?`)
        .all(collection, limit) as { json: string }[];
      return rows.map((r) => JSON.parse(r.json) as T);
    }
    const out: T[] = [];
    for (const row of this.db
      .prepare(`SELECT json FROM docs WHERE collection = ? ORDER BY updated_at DESC`)
      .iterate(collection) as Iterable<{ json: string }>) {
      const doc = JSON.parse(row.json) as T;
      if (filter(doc) && out.push(doc) >= limit) break;
    }
    return out;
  }

  delete(collection: string, id: string): void {
    this.db.prepare(`DELETE FROM docs WHERE collection = ? AND id = ?`).run(collection, id);
  }

  deleteWhere<T>(collection: string, filter: (doc: T) => boolean): void {
    const rows = this.db.prepare(`SELECT id, json FROM docs WHERE collection = ?`).all(collection) as {
      id: string;
      json: string;
    }[];
    for (const row of rows) if (filter(JSON.parse(row.json) as T)) this.delete(collection, row.id);
  }
}

export function newId(prefix: string): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const tail = Array.from(rand, (b) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[b % 32]).join("");
  return `${prefix}_${time}${tail}`;
}

export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString("base64url");
}

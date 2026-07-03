import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema.js";

export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

export function createDatabase(dbPath: string): {
  db: DatabaseInstance;
  sqlite: Database.Database;
} {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  return { db, sqlite };
}

export function runMigrations(
  dbPath: string,
  migrationsFolder: string,
): { db: DatabaseInstance; sqlite: Database.Database } {
  const { db, sqlite } = createDatabase(dbPath);
  migrate(db, { migrationsFolder });
  return { db, sqlite };
}

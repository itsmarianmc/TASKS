import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { dataDirectory } from "@/lib/server/config";
import { migrations } from "./migrations";
import * as schema from "./schema";

export function openDatabase(filename: string) {
  if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  sqlite.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  // Acquire the write lock before inspecting migration state so concurrent startup is safe.
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const migration of migrations) {
      if (!sqlite.prepare("SELECT version FROM schema_migrations WHERE version=?").get(migration.version)) {
        sqlite.exec(migration.sql);
        sqlite.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)").run(migration.version, new Date().toISOString());
      }
    }
    sqlite.exec("COMMIT");
  } catch (error) { sqlite.exec("ROLLBACK"); sqlite.close(); throw error; }
  // Stable Drizzle 0.45 has no node:sqlite adapter. The official SQLite proxy
  // driver feeds positional rows from the built-in driver, avoiding native addons.
  const orm = drizzle(async (sql, params, method) => {
    const statement = sqlite.prepare(sql);
    if (method === "run") { statement.run(...params); return { rows: [] }; }
    statement.setReturnArrays(true);
    if (method === "get") return { rows: (statement.get(...params) as unknown as unknown[]) || [] };
    return { rows: statement.all(...params) as unknown as unknown[][] };
  }, { schema });
  return { sqlite, orm };
}
export type LocalDatabase = ReturnType<typeof openDatabase>;
const dbGlobal = globalThis as typeof globalThis & { taesksDb?: LocalDatabase };
/** The supported single server process has no surviving requests on a fresh start. */
export function recoverInterruptedConversions(database: LocalDatabase) {
  database.sqlite.exec("BEGIN IMMEDIATE");
  try {
    for (const table of ["external_conversion_ledger", "draft_conversion_ledger"]) database.sqlite.prepare(`UPDATE ${table} SET state='uncertain',updated_at=? WHERE state='creating'`).run(new Date().toISOString());
    database.sqlite.prepare("UPDATE recurrence_ledger SET state='failed',updated_at=? WHERE state='creating'").run(new Date().toISOString());
    database.sqlite.exec("COMMIT");
  } catch (error) { database.sqlite.exec("ROLLBACK"); throw error; }
}
export function getDatabase(): LocalDatabase {
  if (!dbGlobal.taesksDb) {
    const database = openDatabase(path.join(dataDirectory(), "taesks.db"));
    recoverInterruptedConversions(database);
    dbGlobal.taesksDb = database;
  }
  return dbGlobal.taesksDb;
}
export function databaseHealth() {
  const result = getDatabase().sqlite.prepare("PRAGMA quick_check(1)").get();
  return result && Object.values(result)[0] === "ok";
}

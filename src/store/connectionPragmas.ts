import type { Database } from "better-sqlite3";
import { logger } from "../utils/logger";

/** How long a connection waits on a locked database before throwing SQLITE_BUSY. */
export const STORE_BUSY_TIMEOUT_MS = 30_000;

/** WAL autocheckpoint interval (~4MB at the default page size). */
export const WAL_AUTOCHECKPOINT_PAGES = 1000;

/** Upper bound for the WAL sidecar file; SQLite reuses but never shrinks it. */
export const WAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

/**
 * Production connection settings shared by every SQLite connection the server
 * opens. These must be applied per connection: `journal_mode` persists on the
 * database file, but `busy_timeout`, `synchronous`, and `foreign_keys` reset
 * to defaults on every new connection.
 *
 * The `busy_timeout` is the load-bearing setting for multi-process use (e.g.
 * parallel scrape workers): without it a writer that arrives while another
 * process holds the write lock fails immediately with SQLITE_BUSY
 * ("database is locked") instead of waiting its turn.
 */
export function applyConnectionPragmas(db: Database): void {
  // WAL mode allows readers while a writer holds the lock. Persistent.
  db.pragma("journal_mode = WAL");

  // Keep durability while avoiding a fsync per transaction.
  db.pragma("synchronous = NORMAL");

  // Wait (rather than fail fast) when another process holds the write lock.
  db.pragma(`busy_timeout = ${STORE_BUSY_TIMEOUT_MS}`);

  db.pragma("foreign_keys = ON");

  // Checkpoint often so the WAL sidecar stays small.
  db.pragma(`wal_autocheckpoint = ${WAL_AUTOCHECKPOINT_PAGES}`);

  // Trim the WAL file back once it resets instead of holding peak size.
  db.pragma(`journal_size_limit = ${WAL_SIZE_LIMIT_BYTES}`);

  logger.debug(
    "Applied shared SQLite connection pragmas (WAL mode, autocheckpoint, WAL size limit, foreign keys, busy timeout)",
  );
}

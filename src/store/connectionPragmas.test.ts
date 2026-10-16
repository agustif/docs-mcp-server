import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../utils/config";
import {
  applyConnectionPragmas,
  STORE_BUSY_TIMEOUT_MS,
  WAL_AUTOCHECKPOINT_PAGES,
  WAL_SIZE_LIMIT_BYTES,
} from "./connectionPragmas";
import { DocumentStore } from "./DocumentStore";

describe("applyConnectionPragmas", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "depworker-pragmas-"));
    dbPath = join(dir, "test.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("enables WAL mode (persists on the file)", () => {
    const db = new Database(dbPath);
    try {
      applyConnectionPragmas(db);
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      db.close();
    }

    // WAL mode is persistent: a fresh connection observes it too.
    const reopened = new Database(dbPath);
    try {
      expect(reopened.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      reopened.close();
    }
  });

  it("sets a non-zero busy timeout so concurrent writers wait instead of failing fast", () => {
    const db = new Database(dbPath);
    try {
      applyConnectionPragmas(db);
      expect(Number(db.pragma("busy_timeout", { simple: true }))).toBe(
        STORE_BUSY_TIMEOUT_MS,
      );
      expect(STORE_BUSY_TIMEOUT_MS).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("applies the remaining production settings", () => {
    const db = new Database(dbPath);
    try {
      applyConnectionPragmas(db);
      // synchronous = NORMAL maps to 1.
      expect(Number(db.pragma("synchronous", { simple: true }))).toBe(1);
      expect(Number(db.pragma("foreign_keys", { simple: true }))).toBe(1);
      expect(Number(db.pragma("wal_autocheckpoint", { simple: true }))).toBe(
        WAL_AUTOCHECKPOINT_PAGES,
      );
      expect(Number(db.pragma("journal_size_limit", { simple: true }))).toBe(
        WAL_SIZE_LIMIT_BYTES,
      );
    } finally {
      db.close();
    }
  });

  it("is idempotent", () => {
    const db = new Database(dbPath);
    try {
      applyConnectionPragmas(db);
      expect(() => applyConnectionPragmas(db)).not.toThrow();
      expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    } finally {
      db.close();
    }
  });
});

describe("DocumentStore constructor", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "depworker-store-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("applies the shared connection pragmas (WAL persists on the file)", async () => {
    const dbPath = join(dir, "store.db");
    const store = new DocumentStore(dbPath, loadConfig());
    try {
      const probe = new Database(dbPath);
      try {
        // journal_mode persists, so a fresh connection observes what the
        // constructor applied. Guards against regressions where the store
        // connection silently runs with defaults (busy_timeout 0), which
        // makes concurrent writers fail fast with SQLITE_BUSY.
        expect(probe.pragma("journal_mode", { simple: true })).toBe("wal");
      } finally {
        probe.close();
      }
    } finally {
      await store.shutdown();
    }
  });
});

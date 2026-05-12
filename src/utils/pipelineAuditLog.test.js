// Tests for pipelineAuditLog.js — Phase B Firebase wire
//
// Firebase modules are mocked so tests run in CI without network or auth.
// The pure helpers (mergeAuditEntries, capLocalEntries) carry the bulk of
// the logic and are tested without any Firebase surface.

jest.mock("../firebase", () => ({
  db: { __mock: "db" },
  auth: { currentUser: null },
}));

const mockPush = jest.fn();
const mockOnValue = jest.fn();
const mockRef = jest.fn((_, path) => ({ __ref: path }));
const mockQuery = jest.fn((r) => r);
const mockLimitToLast = jest.fn((n) => ({ __limit: n }));

jest.mock("firebase/database", () => ({
  ref: (...args) => mockRef(...args),
  push: (...args) => mockPush(...args),
  onValue: (...args) => mockOnValue(...args),
  query: (...args) => mockQuery(...args),
  limitToLast: (...args) => mockLimitToLast(...args),
}));

const firebaseModule = require("../firebase");

const {
  appendAuditEntry,
  subscribeAuditLog,
  readLocalAuditLog,
  mergeAuditEntries,
  capLocalEntries,
  LEGACY_LOCAL_KEY,
  FIREBASE_PATH,
  MAX_LOCAL_ENTRIES,
  MAX_REMOTE_ENTRIES,
} = require("./pipelineAuditLog");

beforeEach(() => {
  window.localStorage.clear();
  mockPush.mockReset();
  mockOnValue.mockReset();
  mockRef.mockClear();
  mockQuery.mockClear();
  mockLimitToLast.mockClear();
  firebaseModule.auth.currentUser = null;
});

// ─── capLocalEntries ─────────────────────────────────────────────────────

describe("capLocalEntries", () => {
  test("returns the array unchanged when under the cap", () => {
    const arr = [{ a: 1 }, { a: 2 }];
    expect(capLocalEntries(arr)).toEqual(arr);
  });

  test("slices from the tail when over the cap", () => {
    const arr = Array.from({ length: 105 }, (_, i) => ({ idx: i }));
    const out = capLocalEntries(arr);
    expect(out).toHaveLength(MAX_LOCAL_ENTRIES);
    expect(out[0]).toEqual({ idx: 5 });
    expect(out[MAX_LOCAL_ENTRIES - 1]).toEqual({ idx: 104 });
  });

  test("respects a custom max", () => {
    expect(capLocalEntries([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  test("returns [] for non-arrays", () => {
    expect(capLocalEntries(null)).toEqual([]);
    expect(capLocalEntries(undefined)).toEqual([]);
    expect(capLocalEntries("nope")).toEqual([]);
  });
});

// ─── mergeAuditEntries ───────────────────────────────────────────────────

describe("mergeAuditEntries", () => {
  test("tags remote entries with _source: firebase", () => {
    const remote = [{ timestamp: "2026-05-11T10:00:00Z", summary: "A" }];
    const out = mergeAuditEntries(remote, []);
    expect(out).toHaveLength(1);
    expect(out[0]._source).toBe("firebase");
  });

  test("tags local-only entries with _source: local", () => {
    const local = [{ timestamp: "2026-05-11T10:00:00Z", summary: "L" }];
    const out = mergeAuditEntries([], local);
    expect(out).toHaveLength(1);
    expect(out[0]._source).toBe("local");
  });

  test("deduplicates local entries that already exist in Firebase by timestamp", () => {
    const ts = "2026-05-11T10:00:00Z";
    const remote = [{ timestamp: ts, summary: "from firebase" }];
    const local = [{ timestamp: ts, summary: "from local" }];
    const out = mergeAuditEntries(remote, local);
    expect(out).toHaveLength(1);
    expect(out[0]._source).toBe("firebase");
    expect(out[0].summary).toBe("from firebase");
  });

  test("sorts merged entries chronologically by timestamp", () => {
    const remote = [
      { timestamp: "2026-05-11T12:00:00Z", summary: "noon" },
      { timestamp: "2026-05-11T08:00:00Z", summary: "morning" },
    ];
    const local = [{ timestamp: "2026-05-11T18:00:00Z", summary: "evening" }];
    const out = mergeAuditEntries(remote, local);
    expect(out.map((e) => e.summary)).toEqual(["morning", "noon", "evening"]);
  });

  test("handles non-array inputs gracefully", () => {
    expect(mergeAuditEntries(null, null)).toEqual([]);
    expect(mergeAuditEntries(undefined, undefined)).toEqual([]);
  });

  test("filters out entries without a timestamp on the local side", () => {
    const local = [{ summary: "no timestamp" }, { timestamp: "2026-05-11T10:00:00Z", summary: "ok" }];
    const out = mergeAuditEntries([], local);
    expect(out).toHaveLength(1);
    expect(out[0].summary).toBe("ok");
  });
});

// ─── readLocalAuditLog ───────────────────────────────────────────────────

describe("readLocalAuditLog", () => {
  test("returns [] when no entry exists", () => {
    expect(readLocalAuditLog()).toEqual([]);
  });

  test("returns parsed array when valid JSON exists", () => {
    const entries = [{ timestamp: "2026-05-11T10:00:00Z", summary: "x" }];
    window.localStorage.setItem(LEGACY_LOCAL_KEY, JSON.stringify(entries));
    expect(readLocalAuditLog()).toEqual(entries);
  });

  test("returns [] when localStorage holds corrupt JSON (does not throw)", () => {
    window.localStorage.setItem(LEGACY_LOCAL_KEY, "{not-json");
    expect(readLocalAuditLog()).toEqual([]);
  });

  test("returns [] when localStorage holds a non-array JSON value", () => {
    window.localStorage.setItem(LEGACY_LOCAL_KEY, JSON.stringify({ not: "array" }));
    expect(readLocalAuditLog()).toEqual([]);
  });
});

// ─── appendAuditEntry ────────────────────────────────────────────────────

describe("appendAuditEntry", () => {
  test("writes to localStorage even when Firebase auth is missing", async () => {
    const entry = { timestamp: "2026-05-11T10:00:00Z", summary: "no-auth test" };
    const result = await appendAuditEntry(entry);

    expect(result.localOnly).toBe(true);
    expect(result.reason).toBe("no-auth");
    expect(result.cycleId).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();

    const stored = JSON.parse(window.localStorage.getItem(LEGACY_LOCAL_KEY));
    expect(stored).toHaveLength(1);
    expect(stored[0].summary).toBe("no-auth test");
  });

  test("writes to both localStorage and Firebase when authenticated", async () => {
    firebaseModule.auth.currentUser = { uid: "anon-test" };
    mockPush.mockResolvedValue({ key: "-N_pushKey_001" });

    const entry = { timestamp: "2026-05-11T10:00:00Z", summary: "authed test" };
    const result = await appendAuditEntry(entry);

    expect(result.localOnly).toBe(false);
    expect(result.cycleId).toBe("-N_pushKey_001");
    expect(mockPush).toHaveBeenCalledTimes(1);

    // Confirm push targeted the right path
    expect(mockRef).toHaveBeenCalledWith(firebaseModule.db, FIREBASE_PATH);

    const stored = JSON.parse(window.localStorage.getItem(LEGACY_LOCAL_KEY));
    expect(stored[0].summary).toBe("authed test");
  });

  test("falls back to localOnly when Firebase push rejects", async () => {
    firebaseModule.auth.currentUser = { uid: "anon-test" };
    mockPush.mockRejectedValue(new Error("PERMISSION_DENIED: rules"));

    const entry = { timestamp: "2026-05-11T10:00:00Z", summary: "rules-block test" };
    const result = await appendAuditEntry(entry);

    expect(result.localOnly).toBe(true);
    expect(result.reason).toMatch(/PERMISSION_DENIED/);
    expect(result.cycleId).toBeNull();

    // Local entry must still have landed
    const stored = JSON.parse(window.localStorage.getItem(LEGACY_LOCAL_KEY));
    expect(stored).toHaveLength(1);
  });

  test("caps local store at MAX_LOCAL_ENTRIES across many appends", async () => {
    const entries = Array.from({ length: MAX_LOCAL_ENTRIES + 5 }, (_, i) => ({
      timestamp: `2026-05-11T${String(i).padStart(2, "0")}:00:00Z`,
      summary: `entry ${i}`,
    }));
    for (const e of entries) {
      // eslint-disable-next-line no-await-in-loop
      await appendAuditEntry(e);
    }

    const stored = JSON.parse(window.localStorage.getItem(LEGACY_LOCAL_KEY));
    expect(stored).toHaveLength(MAX_LOCAL_ENTRIES);
    expect(stored[0].summary).toBe(`entry 5`);
    expect(stored[MAX_LOCAL_ENTRIES - 1].summary).toBe(
      `entry ${MAX_LOCAL_ENTRIES + 4}`
    );
  });
});

// ─── subscribeAuditLog ───────────────────────────────────────────────────

describe("subscribeAuditLog", () => {
  test("returns a no-op unsubscribe when handler is not a function", () => {
    const unsub = subscribeAuditLog(null);
    expect(typeof unsub).toBe("function");
    expect(() => unsub()).not.toThrow();
    expect(mockOnValue).not.toHaveBeenCalled();
  });

  test("bootstraps handler with local entries before Firebase fires", () => {
    const local = [{ timestamp: "2026-05-11T09:00:00Z", summary: "boot" }];
    window.localStorage.setItem(LEGACY_LOCAL_KEY, JSON.stringify(local));

    mockOnValue.mockImplementation(() => () => {}); // no-op listener
    const handler = jest.fn();
    subscribeAuditLog(handler);

    // Handler called immediately with the local bootstrap
    expect(handler).toHaveBeenCalledTimes(1);
    const bootstrapped = handler.mock.calls[0][0];
    expect(bootstrapped).toHaveLength(1);
    expect(bootstrapped[0]._source).toBe("local");
    expect(bootstrapped[0].summary).toBe("boot");
  });

  test("queries Firebase with limitToLast(MAX_REMOTE_ENTRIES)", () => {
    mockOnValue.mockImplementation(() => () => {});
    subscribeAuditLog(() => {});

    expect(mockRef).toHaveBeenCalledWith(firebaseModule.db, FIREBASE_PATH);
    expect(mockLimitToLast).toHaveBeenCalledWith(MAX_REMOTE_ENTRIES);
    expect(mockQuery).toHaveBeenCalled();
    expect(mockOnValue).toHaveBeenCalled();
  });

  test("emits a merged view when Firebase delivers a snapshot", () => {
    const local = [{ timestamp: "2026-05-11T09:00:00Z", summary: "local-A" }];
    window.localStorage.setItem(LEGACY_LOCAL_KEY, JSON.stringify(local));

    let snapHandler;
    mockOnValue.mockImplementation((_, handler) => {
      snapHandler = handler;
      return () => {};
    });

    const handler = jest.fn();
    subscribeAuditLog(handler);

    // Simulate a Firebase snapshot delivering one remote entry
    const remoteVal = {
      "-N_pushKey_REMOTE": {
        timestamp: "2026-05-11T12:00:00Z",
        summary: "remote-B",
      },
    };
    snapHandler({ val: () => remoteVal });

    // 1 bootstrap call (local only) + 1 snapshot call (merged) = 2
    expect(handler).toHaveBeenCalledTimes(2);
    const merged = handler.mock.calls[1][0];
    expect(merged).toHaveLength(2);
    expect(merged[0].summary).toBe("local-A"); // earlier timestamp
    expect(merged[0]._source).toBe("local");
    expect(merged[1].summary).toBe("remote-B");
    expect(merged[1]._source).toBe("firebase");
    expect(merged[1]._cycleId).toBe("-N_pushKey_REMOTE");
  });

  test("falls back to local-only on Firebase subscription error", () => {
    const local = [{ timestamp: "2026-05-11T09:00:00Z", summary: "local-only" }];
    window.localStorage.setItem(LEGACY_LOCAL_KEY, JSON.stringify(local));

    let errHandler;
    mockOnValue.mockImplementation((_, _snap, errCb) => {
      errHandler = errCb;
      return () => {};
    });

    const consoleSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const handler = jest.fn();
    subscribeAuditLog(handler);

    // Simulate a Firebase auth/rules error
    errHandler(new Error("permission denied"));

    // Bootstrap call + error-fallback call
    expect(handler).toHaveBeenCalledTimes(2);
    const fallback = handler.mock.calls[1][0];
    expect(fallback).toHaveLength(1);
    expect(fallback[0]._source).toBe("local");
    consoleSpy.mockRestore();
  });
});

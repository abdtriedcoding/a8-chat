import { useSyncExternalStore } from "react";

/**
 * A copy on the device of data the app has shown, kept in IndexedDB, so a
 * hard load shows it before Convex answers. Callers show a copied value only
 * until the live query loads, and mark it stale meanwhile.
 *
 * The copy belongs to one user. It shows only once the signed-in user is
 * known (setLocalCopyUser) and matches the user who wrote it. A different
 * user clears it first. Sign-out and a lost session clear it
 * (clearLocalCopy).
 *
 * Values are kept in memory too. Writes to IndexedDB wait a moment, so a
 * value that changes on every streamed delta is written about once a second.
 */

const DB_NAME = "a8-local-copy";
const STORE = "copies";
/** The key in STORE that holds the user ID the copy belongs to. */
const OWNER_KEY = "owner";
const THREAD_PREFIX = "thread:";
/** Threads kept, most recently saved first. */
const MAX_THREADS = 20;
const WRITE_DELAY_MS = 1000;

type Entry = { value: unknown; savedAt: number };

let entries = new Map<string, Entry>();
/** Who wrote the copy, from IndexedDB. */
let owner: string | undefined;
/** Who's signed in, from setLocalCopyUser. */
let user: string | undefined;
/**
 * Saves made before the signed-in user's copy was ready. Live data belongs
 * to whoever signs in, so they're kept for that user.
 */
let earlySaves = new Map<string, unknown>();
const pendingWrites = new Map<string, number>();
const listeners = new Set<() => void>();

const db: Promise<IDBDatabase | null> =
  typeof indexedDB === "undefined" ? Promise.resolve(null) : openDb();

/** Set by clearLocalCopy, so a read still in flight doesn't bring it back. */
let clearedBeforeLoad = false;

/** The copy loads once, when this module first runs in the browser. */
const loaded = db.then(async (database) => {
  if (!database) return;
  try {
    const store = database.transaction(STORE).objectStore(STORE);
    const [keys, values] = await Promise.all([
      request(store.getAllKeys()),
      request(store.getAll()),
    ]);
    if (clearedBeforeLoad) return;
    keys.forEach((key, i) => {
      if (key === OWNER_KEY) owner = values[i] as string;
      else entries.set(String(key), values[i] as Entry);
    });
    notify();
  } catch {
    // A copy that can't be read is the same as none.
  }
});

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      // Private windows in some browsers have no IndexedDB.
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Runs `write` in one readwrite transaction, and ignores failures. */
async function writeDb(write: (store: IDBObjectStore) => void) {
  const database = await db;
  if (!database) return;
  try {
    const tx = database.transaction(STORE, "readwrite");
    write(tx.objectStore(STORE));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // A failed write leaves the last copy, which live data replaces anyway.
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readable() {
  return user !== undefined && user === owner;
}

/**
 * Sets the signed-in user, or undefined while it isn't known. A copy written
 * by anyone else is cleared before it can show.
 */
export function setLocalCopyUser(userId: string | undefined) {
  user = userId;
  notify();
  if (userId === undefined) return;
  void loaded.then(() => {
    if (user !== userId) return;
    if (owner !== userId) {
      cancelWrites();
      entries = new Map();
      owner = userId;
      notify();
      void writeDb((store) => {
        store.clear();
        store.put(userId, OWNER_KEY);
      });
    }
    const saves = earlySaves;
    earlySaves = new Map();
    for (const [key, value] of saves) saveLocalCopy(key, value);
  });
}

/** Clears the copy, in memory and on the device, until a user is set again. */
export async function clearLocalCopy() {
  clearedBeforeLoad = true;
  cancelWrites();
  entries = new Map();
  earlySaves = new Map();
  owner = undefined;
  user = undefined;
  notify();
  await loaded;
  await writeDb((store) => store.clear());
}

function cancelWrites() {
  for (const timer of pendingWrites.values()) window.clearTimeout(timer);
  pendingWrites.clear();
}

/** The copied value under `key`, or undefined when there's none to show. */
export function useLocalCopy<T>(key: string | undefined): T | undefined {
  return useSyncExternalStore(
    subscribe,
    () =>
      key !== undefined && readable()
        ? (entries.get(key)?.value as T | undefined)
        : undefined,
    () => undefined,
  );
}

/**
 * Saves `value` under `key`. Until the signed-in user's copy is ready, it
 * waits, so nothing is written for the wrong user.
 */
export function saveLocalCopy(key: string, value: unknown) {
  if (!readable()) {
    earlySaves.set(key, value);
    return;
  }
  if (entries.get(key)?.value === value) return;
  entries = new Map(entries).set(key, { value, savedAt: Date.now() });
  notify();
  scheduleWrite(key);
}

export function removeLocalCopy(key: string) {
  if (!entries.has(key)) return;
  entries = new Map(entries);
  entries.delete(key);
  notify();
  scheduleWrite(key);
}

function scheduleWrite(key: string) {
  if (pendingWrites.has(key)) return;
  pendingWrites.set(
    key,
    window.setTimeout(() => writeEntry(key), WRITE_DELAY_MS),
  );
}

function writeEntry(key: string) {
  window.clearTimeout(pendingWrites.get(key));
  pendingWrites.delete(key);
  const entry = entries.get(key);
  const dropped = key.startsWith(THREAD_PREFIX) ? oldThreads() : [];
  if (dropped.length > 0) {
    entries = new Map(entries);
    for (const old of dropped) entries.delete(old);
    notify();
  }
  void writeDb((store) => {
    if (entry) store.put(entry, key);
    else store.delete(key);
    for (const old of dropped) store.delete(old);
  });
}

// A reload soon after a change would otherwise lose the waiting writes.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const key of [...pendingWrites.keys()]) writeEntry(key);
  });
}

/** Thread keys past the newest MAX_THREADS. */
function oldThreads() {
  return [...entries]
    .filter(([key]) => key.startsWith(THREAD_PREFIX))
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(MAX_THREADS)
    .map(([key]) => key);
}

/** The key of a thread's copy. Only MAX_THREADS of them are kept. */
export function threadCopyKey(threadId: string) {
  return `${THREAD_PREFIX}${threadId}`;
}

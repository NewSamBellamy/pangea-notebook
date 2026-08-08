/**
 * Local-first persistence layer.
 *
 * Books live in IndexedDB (Dexie). Every write also updates an in-memory
 * Map so the app keeps working even if IndexedDB is blocked (e.g. inside a
 * sandboxed iframe/artifact preview) — reads/writes just silently fall back
 * to session-only memory (see `storageMode()`).
 *
 * Settings (Gemini API key + model choices + author name) live in
 * localStorage with the same in-memory fallback pattern.
 *
 * `exportBookJSON` / the Settings "Import a book" flow are the two halves
 * of moving a single book between devices/browsers — the file is just the
 * `Book` object as JSON.
 */

import Dexie, { Table } from 'dexie';
import type { Book, Settings } from './types';

// Local-first storage with graceful fallback (sandboxed iframes may block
// IndexedDB/localStorage — the app must never crash because of storage).

class YokDB extends Dexie {
  books!: Table<Book, string>;
  constructor() {
    super('yok-notebook');
    this.version(1).stores({ books: 'id, updatedAt' });
  }
}

let db: YokDB | null = null;
const memoryBooks = new Map<string, Book>();
let idbOk = true;

try {
  db = new YokDB();
} catch {
  idbOk = false;
}

export async function loadBooks(): Promise<Book[]> {
  if (idbOk && db) {
    try {
      const rows = await db.books.toArray();
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      idbOk = false;
    }
  }
  return [...memoryBooks.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveBook(book: Book): Promise<void> {
  memoryBooks.set(book.id, book);
  if (idbOk && db) {
    try {
      await db.books.put(JSON.parse(JSON.stringify(book)));
    } catch {
      idbOk = false;
    }
  }
}

export async function deleteBook(id: string): Promise<void> {
  memoryBooks.delete(id);
  if (idbOk && db) {
    try {
      await db.books.delete(id);
    } catch {
      idbOk = false;
    }
  }
}

export function storageMode(): 'persistent' | 'session' {
  return idbOk ? 'persistent' : 'session';
}

// ---------- settings (localStorage with memory fallback) ----------

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  textModel: 'gemini-flash-latest',
  imageModel: 'gemini-3.1-flash-image',
  authorName: '',
};

// Older builds defaulted to models Google has retired for new API users.
const MODEL_MIGRATIONS: Record<string, string> = {
  'gemini-2.5-flash': 'gemini-flash-latest',
  'gemini-2.5-pro': 'gemini-pro-latest',
  'gemini-2.5-flash-image': 'gemini-3.1-flash-image',
};

function migrate(s: Settings): Settings {
  return {
    ...s,
    textModel: MODEL_MIGRATIONS[s.textModel] ?? s.textModel,
    imageModel: MODEL_MIGRATIONS[s.imageModel] ?? s.imageModel,
  };
}

let memSettings: Settings | null = null;

export function loadSettings(): Settings {
  if (memSettings) return memSettings;
  try {
    const raw = localStorage.getItem('yok-settings');
    if (raw) {
      memSettings = migrate({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
      return memSettings!;
    }
  } catch {
    /* blocked */
  }
  memSettings = { ...DEFAULT_SETTINGS };
  return memSettings;
}

export function saveSettings(s: Settings): void {
  memSettings = s;
  try {
    localStorage.setItem('yok-settings', JSON.stringify(s));
  } catch {
    /* blocked — memory only */
  }
}

// ---------- export / import ----------

export function exportBookJSON(book: Book): void {
  const blob = new Blob([JSON.stringify(book, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${book.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'book'}.yok.json`;
  a.click();
  URL.revokeObjectURL(url);
}

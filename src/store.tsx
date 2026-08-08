/**
 * Global app state (React context) — the ONLY place `books`/`settings`
 * live in memory. Every mutation goes through `mutateBook` (deep-clones,
 * applies your updater fn, bumps `updatedAt`, persists via storage.ts) so
 * components never touch Dexie directly.
 *
 * Also owns:
 * - View routing (`library` / `newBook` / `book`) — this is a single-page
 *   app with no router; App.tsx just switches on `view`.
 * - Token attribution: listens for the `yok-tokens` window event fired by
 *   src/gemini.ts and adds it to the *active* book, or stashes it in the
 *   module-level `pendingTokens` if no book exists yet (mid-creation) —
 *   claimed via `takePendingTokens()` once the new book is created.
 * - Toasts, focus-view state (which book is "pulled" in the study), and
 *   PALETTES/SPINE_FONTS — the fixed set of book bindings/typefaces every
 *   book picks from.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Book, Settings } from './types';
import { loadBooks, saveBook, deleteBook as dbDelete, loadSettings, saveSettings } from './storage';
import { makeDemoBook } from './demo';

export type View = 'library' | 'newBook' | 'book';

interface StoreShape {
  books: Book[];
  settings: Settings;
  view: View;
  activeBookId: string | null;
  activePageId: string | null; // null = cover / TOC
  ready: boolean;
  toast: string | null;
  /** book to show zoomed in the study's focus view */
  focusBookId: string | null;
  setFocusBook: (id: string | null) => void;
  setView: (v: View) => void;
  openBook: (id: string, pageId?: string | null) => void;
  gotoPage: (pageId: string | null) => void;
  addBook: (b: Book) => void;
  removeBook: (id: string) => void;
  mutateBook: (id: string, fn: (b: Book) => void) => void;
  setSettings: (s: Settings) => void;
  showToast: (msg: string) => void;
}

const Ctx = createContext<StoreShape | null>(null);

// Tokens burned while no book is active (e.g. during new-book creation) are
// stashed here and claimed by the book once it exists.
let pendingTokens = 0;
export function takePendingTokens(): number {
  const t = pendingTokens;
  pendingTokens = 0;
  return t;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [books, setBooks] = useState<Book[]>([]);
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());
  const [view, setView] = useState<View>('library');
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focusBookId, setFocusBook] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    (async () => {
      let rows = await loadBooks();
      if (rows.length === 0) {
        const demo = makeDemoBook();
        await saveBook(demo);
        rows = [demo];
      }
      setBooks(rows);
      setReady(true);
    })();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const openBook = useCallback((id: string, pageId: string | null = null) => {
    setActiveBookId(id);
    setActivePageId(pageId);
    setView('book');
    setBooks((prev) => prev.map((b) => {
      if (b.id !== id) return b;
      const copy = { ...b, lastOpenedAt: Date.now() };
      void saveBook(copy);
      return copy;
    }));
  }, []);

  const gotoPage = useCallback((pageId: string | null) => setActivePageId(pageId), []);

  const addBook = useCallback((b: Book) => {
    setBooks((prev) => [b, ...prev]);
    void saveBook(b);
  }, []);

  const removeBook = useCallback((id: string) => {
    setBooks((prev) => prev.filter((b) => b.id !== id));
    void dbDelete(id);
  }, []);

  const mutateBook = useCallback((id: string, fn: (b: Book) => void) => {
    setBooks((prev) => {
      const next = prev.map((b) => {
        if (b.id !== id) return b;
        const copy: Book = JSON.parse(JSON.stringify(b));
        fn(copy);
        copy.updatedAt = Date.now();
        void saveBook(copy);
        return copy;
      });
      return next;
    });
  }, []);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(s);
  }, []);

  // Attribute Gemini token usage to the active book (or stash for a book being born).
  const activeBookRef = useRef<string | null>(null);
  activeBookRef.current = activeBookId;
  useEffect(() => {
    const onTokens = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (!n) return;
      const id = activeBookRef.current;
      if (id) {
        mutateBook(id, (b) => { b.tokensSpent = (b.tokensSpent ?? 0) + n; });
      } else {
        pendingTokens += n;
      }
    };
    const onAiError = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      if (msg) showToast(`⚠ ${msg}`);
    };
    window.addEventListener('yok-tokens', onTokens);
    window.addEventListener('yok-ai-error', onAiError);
    return () => {
      window.removeEventListener('yok-tokens', onTokens);
      window.removeEventListener('yok-ai-error', onAiError);
    };
  }, [mutateBook, showToast]);

  const value = useMemo<StoreShape>(() => ({
    books, settings, view, activeBookId, activePageId, ready, toast, focusBookId, setFocusBook,
    setView, openBook, gotoPage, addBook, removeBook, mutateBook, setSettings, showToast,
  }), [books, settings, view, activeBookId, activePageId, ready, toast, focusBookId, openBook, gotoPage, addBook, removeBook, mutateBook, setSettings, showToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreShape {
  const s = useContext(Ctx);
  if (!s) throw new Error('store missing');
  return s;
}

// ---------- book cosmetics ----------

export const PALETTES = [
  { name: 'Midnight Voyage', spine: '#1d3a5f', spine2: '#0b1524', accent: '#e8c574', ink: '#f2e8d5' },
  { name: 'Royal Plum', spine: '#4a2a6b', spine2: '#241239', accent: '#e0b0ff', ink: '#f0e8f8' },
  { name: 'Deep Forest', spine: '#1e4a38', spine2: '#0a221a', accent: '#a8d5a0', ink: '#e8f2e0' },
  { name: 'Oxblood', spine: '#6b1d2a', spine2: '#330b12', accent: '#f0c088', ink: '#f8e8dc' },
  { name: 'Slate & Brass', spine: '#37474f', spine2: '#1a2226', accent: '#d4af6a', ink: '#eceff1' },
  { name: 'Desert Rose', spine: '#8d5548', spine2: '#432520', accent: '#f5d5a0', ink: '#faf0e6' },
  { name: 'Ink Black', spine: '#20222b', spine2: '#0d0e13', accent: '#c9a24b', ink: '#e8e6e0' },
  { name: 'Pacific', spine: '#0f5e6b', spine2: '#062b32', accent: '#8fe3d0', ink: '#e0f5f0' },
];

export const SPINE_FONTS = [
  "'Fraunces', serif",
  "'Playfair Display', serif",
  "'IM Fell English', serif",
  "'Cormorant Garamond', serif",
  "'Special Elite', monospace",
];

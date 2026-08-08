/**
 * Applies `AgentAction`s (see src/types.ts) — the structured instructions a
 * model reply can end with — onto a Book. This is the ONLY place that
 * mutates page blocks / TOC / notes on behalf of the AI, so page-image
 * generation-on-apply (`ai.fillImages`) and changelog entries (`addLog`)
 * are guaranteed to stay in sync with whatever the model asked for.
 *
 * `addLog` is also called directly by UI components (drafting, cover
 * re-spin, renames, Create-tab generations, etc.) — it's the single entry
 * point for the book's Logs tab changelog.
 */

import type { AgentAction, Block, Book, LogKind, Settings } from './types';
import { uid } from './types';
import * as ai from './ai';

/** Append a changelog entry to a book (books created before logs existed get the array lazily). */
export function addLog(
  mutate: (fn: (b: Book) => void) => void,
  kind: LogKind,
  summary: string,
  pageId?: string,
): void {
  mutate((b) => {
    (b.logs ??= []).push({ id: uid(), ts: Date.now(), kind, summary, pageId });
    if (b.logs.length > 400) b.logs = b.logs.slice(-400);
  });
}

/** Merge new blocks with old, carrying over imageData for blocks that kept their id. */
function mergeBlocks(oldBlocks: Block[], nextBlocks: Block[]): Block[] {
  const byId = new Map(oldBlocks.map((b) => [b.id, b]));
  return nextBlocks.map((b) => {
    const prev = b.id ? byId.get(b.id) : undefined;
    return {
      ...b,
      id: b.id || uid(),
      imageData: b.imageData ?? (prev && prev.type === 'image' && b.type === 'image' ? prev.imageData : undefined),
    };
  });
}

/**
 * Apply agent actions to a book. Returns a summary of what changed.
 * mutate: store.mutateBook bound to the book id.
 */
export async function applyActions(
  settings: Settings,
  book: Book,
  actions: AgentAction[],
  fallbackPageId: string | null,
  mutate: (fn: (b: Book) => void) => void,
): Promise<string[]> {
  const summary: string[] = [];
  for (const a of actions) {
    if (a.action === 'update_page') {
      const pid = a.pageId ?? fallbackPageId;
      const page = book.pages.find((p) => p.id === pid);
      if (!page || !a.blocks) continue;
      let merged = mergeBlocks(page.blocks, a.blocks);
      merged = await ai.fillImages(settings, book, merged, page.title);
      mutate((b) => {
        const p = b.pages.find((x) => x.id === page.id);
        if (p) { p.blocks = merged; p.drafted = true; }
      });
      summary.push(`Updated “${page.title}”`);
    } else if (a.action === 'update_pages') {
      for (const up of a.pages ?? []) {
        const page = book.pages.find((p) => p.id === up.pageId);
        if (!page) continue;
        let merged = mergeBlocks(page.blocks, up.blocks);
        merged = await ai.fillImages(settings, book, merged, page.title);
        mutate((b) => {
          const p = b.pages.find((x) => x.id === page.id);
          if (p) { p.blocks = merged; p.drafted = true; }
        });
        summary.push(`Updated “${page.title}”`);
      }
    } else if (a.action === 'update_toc') {
      mutate((b) => {
        for (const up of a.pages ?? []) {
          if (up.pageId) {
            const p = b.pages.find((x) => x.id === up.pageId);
            if (!p) continue;
            if (up.title) p.title = up.title;
            if (up.summary) p.summary = up.summary;
            if (up.chapter) p.chapter = up.chapter;
          } else if (up.title) {
            b.pages.push({
              id: uid(), chapter: up.chapter ?? b.pages[b.pages.length - 1]?.chapter ?? 'Addendum',
              title: up.title, summary: up.summary ?? '', blocks: [], annotations: [], drafted: false,
            });
          }
        }
      });
      summary.push(`Restructured the table of contents (${a.pages?.length ?? 0} change(s))`);
    } else if (a.action === 'add_notes') {
      mutate((b) => {
        for (const n of a.notes ?? []) {
          if (!b.pages.some((p) => p.id === n.pageId)) continue;
          b.notes.push({ id: uid(), pageId: n.pageId, text: n.text, resolved: false, createdAt: Date.now() });
        }
      });
      summary.push(`Left ${a.notes?.length ?? 0} note(s)`);
    }
  }
  return summary;
}

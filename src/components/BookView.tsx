/**
 * The open-book two-page spread: left leaf is the live page (PageCanvas)
 * or the cover/TOC (CoverPage), right leaf is the ChatPanel (Scribe /
 * Research / Create / Notes / Logs / Assets). Owns:
 * - Page navigation + the page-turn animation (`flip`): a real leaf,
 *   hinged at the gutter, carrying the destination page's actual content
 *   on its back face (StaticPageFace) so the turn looks like a real book,
 *   not a generic transition.
 * - Annotation state (add/erase) and sticky notes.
 * - The Read Session → page audit flow: starts SpeechRecognition (if
 *   available), timestamps annotations against it, and on "End audit"
 *   compiles everything into a `PendingAudit` that the ChatPanel's Scribe
 *   tab pre-fills for the creator to review before sending.
 */

import React, { useCallback, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import type { Annotation, Block, PendingAudit, Tool, TranscriptSeg } from '../types';
import { uid } from '../types';
import { useStore } from '../store';
import * as ai from '../ai';
import { applyActions, addLog } from '../actions';
import { PageCanvas, CoverPage, StaticPageFace } from './PageCanvas';
import { ChatPanel } from './ChatPanel';
import { ImageStudio } from './ImageStudio';
import { exportBookJSON } from '../storage';

interface SR {
  start: () => void;
  stop: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null;
}

export function BookView() {
  const { books, activeBookId } = useStore();
  const book = books.find((b) => b.id === activeBookId);
  if (!book) return null;
  return <BookViewInner book={book} />;
}

function BookViewInner({ book }: { book: import('../types').Book }) {
  const { books, activePageId, gotoPage, setView, settings, mutateBook, showToast } = useStore();
  const [tool, setTool] = useState<Tool>('cursor');
  const [drafting, setDrafting] = useState(false);
  const [imgBlock, setImgBlock] = useState<Block | null>(null);
  const [session, setSession] = useState<{ id: string; startedAt: number } | null>(null);
  const [pendingAudit, setPendingAudit] = useState<PendingAudit | null>(null);
  // The turning leaf carries real page content: for "next" the incoming page rides
  // the back face and lands on the left leaf; for "prev" the outgoing page lifts off it.
  const [flip, setFlip] = useState<null | {
    dir: 'next' | 'prev';
    content: import('../types').Page | null;
    rect: { left: number; top: number; width: number; height: number };
  }>(null);
  const flipTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const spreadRef = useRef<HTMLDivElement>(null);
  const leftLeafRef = useRef<HTMLDivElement>(null);
  const [auditing, setAuditing] = useState(false);
  const [micState, setMicState] = useState<'off' | 'on' | 'unavailable'>('off');
  const transcript = useRef<TranscriptSeg[]>([]);
  const recRef = useRef<SR | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const pageIdx = activePageId ? book.pages.findIndex((p) => p.id === activePageId) : -1;
  const page = pageIdx >= 0 ? book.pages[pageIdx] : null;

  const nav = useCallback((dir: 1 | -1) => {
    const next = pageIdx + dir;
    // hinge the turning sheet at the left page's outer edge so it lands pixel-perfect
    const sp = spreadRef.current?.getBoundingClientRect();
    const ll = leftLeafRef.current?.getBoundingClientRect();
    if (sp && ll) {
      const content = dir === 1
        ? (pageIdx === -1 ? book.pages[0] : book.pages[next]) ?? null // incoming page rides the leaf
        : (pageIdx >= 0 ? book.pages[pageIdx] : null); // outgoing page lifts off the left
      setFlip({
        dir: dir === 1 ? 'next' : 'prev',
        content,
        rect: { left: ll.right - sp.left, top: ll.top - sp.top, width: ll.width, height: ll.height },
      });
      if (flipTimer.current) clearTimeout(flipTimer.current);
      flipTimer.current = setTimeout(() => setFlip(null), 900);
    }
    if (pageIdx === -1 && dir === 1) gotoPage(book.pages[0]?.id ?? null);
    else if (next < 0) gotoPage(null);
    else if (next < book.pages.length) gotoPage(book.pages[next].id);
    setTool('cursor');
  }, [pageIdx, book.pages, gotoPage]);

  // ---------- drafting ----------
  async function draftCurrent() {
    if (!page || drafting) return;
    setDrafting(true);
    try {
      let blocks = await ai.draft(settings, book, page);
      blocks = await ai.fillImages(settings, book, blocks, page.title);
      mutateBook(book.id, (b) => {
        const p = b.pages.find((x) => x.id === page.id);
        if (p) { p.blocks = blocks; p.drafted = true; }
      });
      addLog((fn) => mutateBook(book.id, fn), 'draft', `Drafted “${page.title}”`, page.id);
      showToast(`“${page.title}” drafted`);
    } catch (e) {
      showToast(`Draft failed: ${(e as Error).message}`);
    } finally {
      setDrafting(false);
    }
  }

  // ---------- annotations & notes ----------
  const onAnnotate = (a: Annotation) => {
    if (!page) return;
    const stamped: Annotation = session
      ? { ...a, sessionId: session.id, t: (Date.now() - session.startedAt) / 1000 }
      : a;
    mutateBook(book.id, (b) => {
      const p = b.pages.find((x) => x.id === page.id);
      p?.annotations.push(stamped);
    });
  };
  const onErase = (id: string) => {
    if (!page) return;
    mutateBook(book.id, (b) => {
      const p = b.pages.find((x) => x.id === page.id);
      if (p) p.annotations = p.annotations.filter((x) => x.id !== id);
    });
  };
  const onAddNote = (text: string, x: number, y: number) => {
    if (!page) return;
    mutateBook(book.id, (b) => {
      b.notes.push({ id: uid(), pageId: page.id, text, resolved: false, createdAt: Date.now(), x, y });
    });
    showToast('Note pinned — it’ll wait for you on the cover too');
  };
  const onResolveNote = (id: string) => {
    mutateBook(book.id, (b) => {
      const n = b.notes.find((x) => x.id === id);
      if (n) n.resolved = true;
    });
  };

  // ---------- read session ----------
  function startSession() {
    if (!page) return;
    const s = { id: uid(), startedAt: Date.now() };
    transcript.current = [];
    setSession(s);
    const Ctor = (window as unknown as Record<string, unknown>).SpeechRecognition
      ?? (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (typeof Ctor === 'function') {
      try {
        const rec = new (Ctor as new () => SR)();
        rec.continuous = true;
        rec.interimResults = false;
        rec.lang = 'en-US';
        rec.onresult = (e) => {
          for (let i = e.resultIndex; i < (e.results as unknown as { length: number }).length; i++) {
            const r = e.results[i];
            if (r.isFinal) {
              transcript.current.push({ t: (Date.now() - s.startedAt) / 1000, text: r[0].transcript.trim() });
            }
          }
        };
        rec.onend = () => { /* may auto-stop; that's fine */ };
        rec.start();
        recRef.current = rec;
        setMicState('on');
      } catch {
        setMicState('unavailable');
      }
    } else {
      setMicState('unavailable');
    }
    showToast('Read session started — mark it up and think out loud');
  }

  /** End the audit: compile ink + voice into a draft the creator reviews in the Scribe, then sends. */
  async function endSession() {
    if (!session || !page) return;
    try { recRef.current?.stop(); } catch { /* noop */ }
    recRef.current = null;
    const s = session;
    setSession(null);
    setMicState('off');
    setTool('cursor');
    setAuditing(true);
    try {
      const anns = book.pages.find((p) => p.id === page.id)?.annotations.filter((a) => a.sessionId === s.id) ?? [];
      let snapshot: string | null = null;
      if (contentRef.current && ai.isLive(settings)) {
        try {
          const c = await html2canvas(contentRef.current, { scale: 1, logging: false, backgroundColor: '#f7f1e3' });
          snapshot = c.toDataURL('image/jpeg', 0.8);
        } catch { /* snapshot optional */ }
      }
      const said = transcript.current.map((t) => t.text).join(' ').trim();
      const draftText = [
        `Apply my audit of “${page.title}” — ${anns.length} mark${anns.length === 1 ? '' : 's'} on the page`,
        said ? `; I said: “${said.slice(0, 260)}${said.length > 260 ? '…' : ''}”` : '',
        '.',
      ].join('');
      setPendingAudit({ pageId: page.id, annotations: anns, transcript: [...transcript.current], snapshot, draftText });
      showToast('Audit compiled — review it in the Scribe, add anything, and send');
    } finally {
      setAuditing(false);
    }
  }

  const pageNotes = page ? book.notes.filter((n) => n.pageId === page.id && !n.resolved) : [];

  return (
    <div className="bookview">
      <header className="bv-bar">
        <button className="btn btn-ghost" onClick={() => { setView('library'); }}>⌂ Library</button>
        <button className="bv-title" onClick={() => gotoPage(null)} title="Go to cover">
          {book.title}
        </button>
        <div className="bv-nav">
          <button className="btn btn-ghost" disabled={pageIdx === -1} onClick={() => nav(-1)}>‹</button>
          <span className="bv-pageno">{pageIdx === -1 ? 'Cover' : `${pageIdx + 1} / ${book.pages.length}`}</span>
          <button className="btn btn-ghost" disabled={pageIdx >= book.pages.length - 1} onClick={() => nav(1)}>›</button>
        </div>
        <div className="bv-right">
          <button className="btn btn-ghost" title="Export book JSON" onClick={() => exportBookJSON(book)}>⤓</button>
        </div>
      </header>

      <div className="spread" ref={spreadRef}>
        <div className="leaf leaf-left" ref={leftLeafRef} key={activePageId ?? 'cover'}>
          {page ? (
            <PageCanvas
              book={book} page={page} tool={tool} setTool={setTool}
              sessionActive={!!session}
              auditing={auditing} micState={micState}
              onStartAudit={startSession} onEndAudit={() => void endSession()}
              onAnnotate={onAnnotate} onEraseAnnotation={onErase}
              onAddNote={onAddNote} onResolveNote={onResolveNote}
              notes={pageNotes}
              onImageClick={(b) => setImgBlock(b)}
              onDraft={() => void draftCurrent()} drafting={drafting}
              contentRef={contentRef}
            />
          ) : (
            <div className="page-scroll">
              <CoverPage book={book} onJump={(pid) => gotoPage(pid)}
                onRenamePage={(pid, title) => {
                  mutateBook(book.id, (b) => {
                    const p = b.pages.find((x) => x.id === pid);
                    if (p) p.title = title;
                  });
                  addLog((fn) => mutateBook(book.id, fn), 'rename', `Page renamed to “${title}”`, pid);
                }} />
            </div>
          )}
        </div>
        <div className="gutter" />
        <div className="leaf leaf-right">
          <ChatPanel book={book} page={page} pendingAudit={pendingAudit} clearPendingAudit={() => setPendingAudit(null)} />
        </div>
        {/* the turning leaf — hinged at the gutter, carrying real page content on its back face */}
        {flip && (
          <div className={`flip-sheet ${flip.dir}`}
            style={{ left: flip.rect.left, top: flip.rect.top, width: flip.rect.width, height: flip.rect.height }}>
            <div className="flip-leaf">
              <div className="flip-face front" />
              <div className="flip-face back">
                {flip.content && <StaticPageFace page={flip.content} />}
              </div>
            </div>
          </div>
        )}
      </div>

      {imgBlock && page && (
        <ImageStudio book={book} pageId={page.id} block={imgBlock} onClose={() => setImgBlock(null)} />
      )}
    </div>
  );
}

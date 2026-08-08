/**
 * The right-hand leaf of an open book — six tabs, two context levels
 * (page-scoped when a page is open, book-scoped at the cover/TOC):
 *
 * - Scribe    — chat that edits THIS page (or, at the cover, the whole
 *               book/TOC). Renders AgentAction results via src/actions.ts.
 *               Also where a compiled PendingAudit lands for review+send.
 * - Research  — Google Search–grounded chat, file/image/PDF attachments,
 *               a "Deep research" toggle (report → Assets), optional
 *               "attach last audit" context. Does NOT edit the book.
 * - Create    — the AI Studio-style atelier: Image/Writing modes, real
 *               model pickers (TEXT_MODELS/IMAGE_MODELS), a collapsible
 *               run-settings drawer (temperature/output length/thinking/
 *               system instructions/aspect) persisted per book
 *               (`book.studio`), "book context" toggle, results saved to
 *               Assets, images placeable directly onto the open page.
 * - Notes     — sticky-note-style open tasks; book-level view also hosts
 *               the Brain Dump (paste scattered notes → sorted per page).
 * - Logs      — changelog of every mutation (drafts, edits, audits, cover
 *               respins, renames, creations) — see src/actions.ts addLog.
 * - Assets    — every image/report/writing born on this page (or the
 *               whole book, at the cover), with a lightbox viewer.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { Attachment, Book, BrainDumpAssignment, LogEntry, Msg, Page, PendingAudit, StudioPrefs } from '../types';
import { uid, DEFAULT_STUDIO, TEXT_MODELS, IMAGE_MODELS } from '../types';
import { useStore } from '../store';
import * as ai from '../ai';
import { applyActions, addLog } from '../actions';

type Tab = 'scribe' | 'research' | 'create' | 'notes' | 'logs' | 'assets';

const LOG_ICONS: Record<string, string> = {
  draft: '✒', canvas: '✎', image: '▣', cover: '◈', rename: '✎',
  note: '⚑', audit: '⊙', research: '⌕', toc: '☰', dump: '≋', create: '✦',
};

const fmtTokens = (n?: number) => {
  if (!n) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(2)}M`;
};

const ago = (t: number) => {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export function ChatPanel({ book, page, pendingAudit, clearPendingAudit }: {
  book: Book;
  page: Page | null;
  pendingAudit: PendingAudit | null;
  clearPendingAudit: () => void;
}) {
  const { settings, mutateBook, showToast, gotoPage } = useStore();
  const [tab, setTab] = useState<Tab>('scribe');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [rInput, setRInput] = useState('');
  const [rBusy, setRBusy] = useState(false);
  const [deep, setDeep] = useState(false);
  const [attachAudit, setAttachAudit] = useState(false);
  const [dumpText, setDumpText] = useState('');
  const [dumpPreview, setDumpPreview] = useState<BrainDumpAssignment[] | null>(null);
  const [dumpOpen, setDumpOpen] = useState(false);
  const [readAsset, setReadAsset] = useState<string | null>(null);
  // research attachments (Gemini-style: bring documents & photos into the conversation)
  const [rAtt, setRAtt] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // create tab — an AI studio bound into the book (run settings persist per book)
  const [cMode, setCMode] = useState<'image' | 'text'>('image');
  const [cPrompt, setCPrompt] = useState('');
  const [cUseCtx, setCUseCtx] = useState(true);
  const [cBusy, setCBusy] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [studio, setStudioState] = useState<StudioPrefs>({ ...DEFAULT_STUDIO, ...(book.studio ?? {}) });
  const setStudio = (patch: Partial<StudioPrefs>) => {
    const next = { ...studio, ...patch };
    setStudioState(next);
    mutateBook(book.id, (b) => { b.studio = next; });
  };
  // image lightbox — finally a real way to VIEW what you've made
  const [lightbox, setLightbox] = useState<{ src: string; title: string; assetId?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const log = (kind: Parameters<typeof addLog>[1], summary: string, pageId?: string) =>
    addLog((fn) => mutateBook(book.id, fn), kind, summary, pageId);

  const scopeKey = page?.id ?? 'book';
  const msgs: Msg[] = page ? (book.pageChats[page.id] ?? []) : book.bookChat;
  const rMsgs: Msg[] = book.researchChats?.[scopeKey] ?? [];

  // A finished page audit lands in the Scribe input as an editable draft.
  useEffect(() => {
    if (pendingAudit && page && pendingAudit.pageId === page.id) {
      setTab('scribe');
      setInput(pendingAudit.draftText);
    }
  }, [pendingAudit, page]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [msgs.length, rMsgs.length, busy, rBusy, tab]);

  function pushMsg(m: Msg) {
    mutateBook(book.id, (b) => {
      if (page) b.pageChats[page.id] = [...(b.pageChats[page.id] ?? []), m];
      else b.bookChat.push(m);
    });
  }

  function pushResearchMsg(m: Msg) {
    mutateBook(book.id, (b) => {
      b.researchChats ??= {};
      b.researchChats[scopeKey] = [...(b.researchChats[scopeKey] ?? []), m];
    });
  }

  const auditHere = pendingAudit && page && pendingAudit.pageId === page.id ? pendingAudit : null;

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    pushMsg({ id: uid(), role: 'user', text, ts: Date.now(), meta: auditHere ? 'audit-request' : undefined });
    setBusy(true);
    try {
      let res;
      if (auditHere && page) {
        res = await ai.audit(settings, book, page, auditHere.annotations, auditHere.transcript, auditHere.snapshot, text);
        clearPendingAudit();
      } else {
        res = await ai.chat(settings, book, page, msgs, text);
      }
      let meta: string | undefined = auditHere ? 'audit' : undefined;
      if (res.actions.length) {
        const changed = await applyActions(settings, book, res.actions, page?.id ?? null, (fn) => mutateBook(book.id, fn));
        if (changed.length) {
          meta = auditHere ? 'audit' : 'canvas-updated';
          showToast(changed.join(' · '));
          for (const c of changed) {
            log(auditHere ? 'audit' : c.includes('table of contents') ? 'toc' : c.includes('note') ? 'note' : 'canvas', c, page?.id);
          }
        }
      }
      pushMsg({ id: uid(), role: 'model', text: res.text || '(canvas updated)', ts: Date.now(), meta });
    } catch (e) {
      pushMsg({ id: uid(), role: 'model', text: `⚠ ${(e as Error).message}`, ts: Date.now() });
    } finally {
      setBusy(false);
    }
  }

  const lastAuditLog = [...(book.logs ?? [])].reverse().find((l) => l.kind === 'audit' && (!page || l.pageId === page.id));

  async function addAttachment(file: File) {
    if (rAtt.length >= 3) { showToast('Up to 3 attachments per message'); return; }
    if (file.size > 8 * 1024 * 1024) { showToast('Attachments up to 8MB'); return; }
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve((fr.result as string).split(',')[1]);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
    setRAtt((a) => [...a, { name: file.name, mimeType: file.type || 'application/octet-stream', data }]);
  }

  async function sendResearch() {
    const text = rInput.trim();
    if ((!text && rAtt.length === 0) || rBusy) return;
    const atts = rAtt;
    setRInput('');
    setRAtt([]);
    pushResearchMsg({
      id: uid(), role: 'user', text: text || '(attached files)', ts: Date.now(),
      meta: deep ? 'deep' : undefined,
      attachmentNames: atts.length ? atts.map((a) => a.name) : undefined,
    });
    setRBusy(true);
    try {
      const res = await ai.research(settings, book, page, rMsgs, text || 'Consider the attached material in the context of this project.', {
        deep,
        model: studio.researchModel,
        auditNote: attachAudit && lastAuditLog ? lastAuditLog.summary : undefined,
        attachments: atts.map((a) => ({ mimeType: a.mimeType, data: a.data })),
      });
      pushResearchMsg({ id: uid(), role: 'model', text: res.text, ts: Date.now(), sources: res.sources.slice(0, 8), meta: deep ? 'deep' : undefined });
      if (deep) {
        mutateBook(book.id, (b) => {
          (b.assets ??= []).push({
            id: uid(), ts: Date.now(), pageId: page?.id,
            type: 'report', title: text.slice(0, 80), content: res.text,
          });
        });
        log('research', `Deep research report: “${text.slice(0, 60)}”`, page?.id);
        showToast('Report filed under Assets');
      }
      setAttachAudit(false);
    } catch (e) {
      pushResearchMsg({ id: uid(), role: 'model', text: `⚠ ${(e as Error).message}`, ts: Date.now() });
    } finally {
      setRBusy(false);
    }
  }

  // Create tab: generate an asset (image or text) into the book
  async function runCreate() {
    const prompt = cPrompt.trim();
    if (!prompt || cBusy) return;
    setCBusy(true);
    try {
      const context = cUseCtx
        ? `"${book.title}" — ${book.plan.prompt.slice(0, 220)}${book.plan.vibe ? ` (vibe: ${book.plan.vibe})` : ''}${page ? `. This is for the page "${page.title}": ${page.summary}` : ''}`
        : undefined;
      if (cMode === 'image') {
        const img = await ai.createImage(settings, prompt, {
          model: studio.imageModel, aspect: studio.aspect, temperature: studio.temperature, context,
        });
        mutateBook(book.id, (b) => {
          (b.assets ??= []).push({ id: uid(), ts: Date.now(), pageId: page?.id, type: 'image', title: prompt.slice(0, 80), content: prompt, imageData: img });
        });
        log('create', `Image created (${studio.imageModel}): “${prompt.slice(0, 60)}”`, page?.id);
        showToast('Image created — it lives in Assets');
      } else {
        const text = await ai.createText(settings, prompt, {
          model: studio.textModel, temperature: studio.temperature,
          maxOutputTokens: studio.maxOutputTokens, thinking: studio.thinking,
          system: studio.systemInstruction, context,
        });
        const newId = uid();
        mutateBook(book.id, (b) => {
          (b.assets ??= []).push({ id: newId, ts: Date.now(), pageId: page?.id, type: 'text', title: prompt.slice(0, 80), content: text });
        });
        log('create', `Writing created (${studio.textModel}): “${prompt.slice(0, 60)}”`, page?.id);
        setReadAsset(newId);
      }
      setCPrompt('');
    } catch (e) {
      showToast(`Create failed: ${(e as Error).message}`);
    } finally {
      setCBusy(false);
    }
  }

  function addAssetToPage(assetId: string) {
    if (!page) return;
    const a = (book.assets ?? []).find((x) => x.id === assetId);
    if (!a?.imageData) return;
    mutateBook(book.id, (b) => {
      const p = b.pages.find((x) => x.id === page.id);
      if (p) p.blocks.push({ id: uid(), type: 'image', imagePrompt: a.content, imageData: a.imageData, caption: a.title });
    });
    log('image', `Created image placed on “${page.title}”`, page.id);
    showToast('Placed on the page');
  }

  async function runDump() {
    if (!dumpText.trim() || busy) return;
    setBusy(true);
    try {
      const res = await ai.dump(settings, book, dumpText);
      setDumpPreview(res);
    } catch (e) {
      showToast(`Brain dump failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function applyDump() {
    if (!dumpPreview) return;
    mutateBook(book.id, (b) => {
      for (const a of dumpPreview) {
        if (!b.pages.some((p) => p.id === a.pageId)) continue;
        b.notes.push({ id: uid(), pageId: a.pageId, text: a.noteText, resolved: false, createdAt: Date.now() });
      }
    });
    log('dump', `Brain dump sorted — ${dumpPreview.length} notes filed`);
    showToast(`${dumpPreview.length} notes sorted into the book`);
    setDumpPreview(null);
    setDumpText('');
    setDumpOpen(false);
  }

  const scopeNotes = book.notes.filter((n) => (page ? n.pageId === page.id : true));
  const openCount = book.notes.filter((n) => !n.resolved && (page ? n.pageId === page.id : true)).length;
  const scopeLogs: LogEntry[] = [...(book.logs ?? [])].filter((l) => (page ? l.pageId === page.id : true)).reverse();
  const imageAssets = (page ? [page] : book.pages).flatMap((p) =>
    p.blocks.filter((b) => b.type === 'image' && b.imageData).map((b) => ({ page: p, block: b })));
  const scopeAssets = (book.assets ?? []).filter((a) => (page ? a.pageId === page.id : true));
  const reportAssets = scopeAssets.filter((a) => a.type === 'report' || a.type === 'text');
  const createdImages = [...scopeAssets.filter((a) => a.type === 'image' && a.imageData)].reverse();

  return (
    <div className="chatpanel">
      <div className="chat-tabs">
        <button className={tab === 'scribe' ? 'on' : ''} onClick={() => setTab('scribe')}>✎ Scribe</button>
        <button className={tab === 'research' ? 'on' : ''} onClick={() => setTab('research')}>⌕ Research</button>
        <button className={tab === 'create' ? 'on' : ''} onClick={() => setTab('create')}>✦ Create</button>
        <button className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>⚑ Notes{openCount ? ` (${openCount})` : ''}</button>
        <button className={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}>☰ Logs</button>
        <button className={tab === 'assets' ? 'on' : ''} onClick={() => setTab('assets')}>▣ Assets</button>
      </div>

      {tab === 'scribe' && (
        <>
          <div className="chat-scroll" ref={scrollRef}>
            {msgs.length === 0 && (
              <div className="chat-empty">
                {page
                  ? <>The Scribe changes <b>this page</b>. Say what you want — <i>“rewrite the opening”, “add a beat where…”</i> — and it writes straight onto the canvas. Finish a page audit and it lands here for you to send.</>
                  : <>The Scribe at the cover works on the <b>whole book</b> — restructure the table of contents, retitle pages, or make sweeping changes across chapters.</>}
              </div>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.meta === 'canvas-updated' && <span className="bubble-badge">✎ canvas updated</span>}
                {m.meta === 'audit' && <span className="bubble-badge audit">⊙ audit applied</span>}
                {m.meta === 'audit-request' && <span className="bubble-badge audit">⊙ page audit</span>}
                <div className="bubble-text">{m.text}</div>
              </div>
            ))}
            {busy && <div className="bubble model thinking"><span /><span /><span /></div>}
          </div>
          {auditHere && (
            <div className="audit-pending">
              ⊙ Audit compiled — {auditHere.annotations.length} mark{auditHere.annotations.length === 1 ? '' : 's'}
              {auditHere.transcript.length ? ' + voice' : ''}{auditHere.snapshot ? ' + page snapshot' : ''} attached.
              Edit the message below, then send to apply.
              <button className="btn btn-mini btn-ghost" onClick={() => { clearPendingAudit(); setInput(''); }}>discard</button>
            </div>
          )}
          <div className="chat-input">
            <textarea
              rows={2}
              placeholder={page ? 'Change this page… ("rewrite the opening", "add a beat where…")' : 'Change the book… ("retitle chapter 3", "tighten act two across all pages")'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            />
            <button className="btn btn-gold chat-send" disabled={busy || !input.trim()} onClick={() => void send()}>➤</button>
          </div>
        </>
      )}

      {tab === 'research' && (
        <>
          <div className="chat-scroll" ref={scrollRef}>
            {rMsgs.length === 0 && (
              <div className="chat-empty">
                The <b>research desk</b>{page ? <> for “{page.title}”</> : <> for the whole book</>} — live Google-grounded answers, brainstorming, comparisons. Nothing here edits the book; take what's good to the Scribe. Flip on <b>Deep research</b> for a full report filed to Assets.
              </div>
            )}
            {rMsgs.map((m) => (
              <div key={m.id} className={`bubble ${m.role}`}>
                {m.meta === 'deep' && <span className="bubble-badge research">⌕ deep research</span>}
                {m.attachmentNames && m.attachmentNames.length > 0 && (
                  <div className="att-chips">{m.attachmentNames.map((n, i) => <span key={i} className="att-chip">📎 {n}</span>)}</div>
                )}
                <div className="bubble-text">{m.text}</div>
                {m.sources && m.sources.length > 0 && (
                  <div className="bubble-sources">
                    {m.sources.map((s, i) => (
                      <a key={i} href={s.uri} target="_blank" rel="noopener noreferrer" title={s.uri}>{i + 1}. {s.title.slice(0, 50)}</a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {rBusy && <div className="bubble model thinking"><span /><span /><span /></div>}
          </div>
          <div className="research-opts">
            <select className="cselect mini" value={studio.researchModel} onChange={(e) => setStudio({ researchModel: e.target.value })} title="Research model">
              {TEXT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <label className={`ropt ${deep ? 'on' : ''}`}>
              <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
              ⌕ Deep research {deep && '(report → Assets)'}
            </label>
            {lastAuditLog && (
              <label className={`ropt ${attachAudit ? 'on' : ''}`}>
                <input type="checkbox" checked={attachAudit} onChange={(e) => setAttachAudit(e.target.checked)} />
                ⊙ Attach last audit
              </label>
            )}
            <button className="ropt" onClick={() => fileRef.current?.click()} title="Attach documents or photos — PDFs, images, text">
              📎 Attach
            </button>
            <input ref={fileRef} type="file" hidden multiple
              accept="image/*,application/pdf,text/plain,text/markdown"
              onChange={(e) => { [...(e.target.files ?? [])].forEach((f) => void addAttachment(f)); e.target.value = ''; }} />
            {rAtt.map((a, i) => (
              <span key={i} className="att-chip pending">
                📎 {a.name.slice(0, 24)}
                <button onClick={() => setRAtt((x) => x.filter((_, j) => j !== i))}>✕</button>
              </span>
            ))}
          </div>
          <div className="chat-input">
            <textarea
              rows={2}
              placeholder={deep ? 'Deep research question… ("state of AI video tools for indie film, Aug 2026")' : 'Ask anything — live search is on…'}
              value={rInput}
              onChange={(e) => setRInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendResearch(); } }}
            />
            <button className="btn btn-gold chat-send" disabled={rBusy || !rInput.trim()} onClick={() => void sendResearch()}>➤</button>
          </div>
        </>
      )}

      {tab === 'create' && (
        <div className="chat-scroll create-pane">
          <div className="studio-head">
            <div className="cseg">
              <button className={cMode === 'image' ? 'on' : ''} onClick={() => setCMode('image')}>▣ Image</button>
              <button className={cMode === 'text' ? 'on' : ''} onClick={() => setCMode('text')}>✎ Writing</button>
            </div>
            {cMode === 'image' ? (
              <select className="cselect model" value={studio.imageModel} onChange={(e) => setStudio({ imageModel: e.target.value })} title="Image model">
                {IMAGE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            ) : (
              <select className="cselect model" value={studio.textModel} onChange={(e) => setStudio({ textModel: e.target.value })} title="Model">
                {TEXT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            )}
            <button className={`runset-toggle ${runOpen ? 'on' : ''}`} onClick={() => setRunOpen(!runOpen)} title="Run settings">
              ⚙ {studio.temperature.toFixed(1)}° {runOpen ? '▾' : '▸'}
            </button>
          </div>

          {runOpen && (
            <div className="runset">
              <div className="runset-row">
                <label>Temperature <b>{studio.temperature.toFixed(2)}</b></label>
                <input type="range" min="0" max="2" step="0.05" value={studio.temperature}
                  onChange={(e) => setStudio({ temperature: parseFloat(e.target.value) })} />
              </div>
              {cMode === 'text' ? (
                <>
                  <div className="runset-row">
                    <label>Output length</label>
                    <select className="cselect" value={studio.maxOutputTokens} onChange={(e) => setStudio({ maxOutputTokens: parseInt(e.target.value, 10) })}>
                      <option value={1024}>Short — 1k tokens</option>
                      <option value={4096}>Medium — 4k</option>
                      <option value={8192}>Long — 8k</option>
                      <option value={16384}>Very long — 16k</option>
                    </select>
                  </div>
                  <div className="runset-row">
                    <label>Thinking</label>
                    <select className="cselect" value={studio.thinking} onChange={(e) => setStudio({ thinking: e.target.value as StudioPrefs['thinking'] })}>
                      <option value="auto">Auto</option>
                      <option value="low">Quick — low</option>
                      <option value="high">Deep — high</option>
                    </select>
                  </div>
                  <div className="runset-row full">
                    <label>System instructions</label>
                    <textarea rows={2} placeholder="Persistent voice or rules for everything you create here…"
                      value={studio.systemInstruction} onChange={(e) => setStudio({ systemInstruction: e.target.value })} />
                  </div>
                </>
              ) : (
                <div className="runset-row">
                  <label>Aspect ratio</label>
                  <select className="cselect" value={studio.aspect} onChange={(e) => setStudio({ aspect: e.target.value })}>
                    <option value="16:9">16:9 wide</option>
                    <option value="1:1">1:1 square</option>
                    <option value="3:4">3:4 portrait</option>
                    <option value="9:16">9:16 tall</option>
                    <option value="21:9">21:9 cinematic</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div className="create-form">
            <textarea rows={3}
              placeholder={cMode === 'image'
                ? 'Describe the image… ("the Argo docked at a fog-wrapped SF pier at dawn, engraved storybook style")'
                : 'What should be written? ("a 60-second teaser script", "the captain\'s toast at the Series A dinner")'}
              value={cPrompt} onChange={(e) => setCPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void runCreate(); } }} />
            <div className="create-actions">
              <button className="btn btn-gold" disabled={cBusy || !cPrompt.trim()} onClick={() => void runCreate()}>
                {cBusy ? 'Creating…' : cMode === 'image' ? '✦ Generate image' : '✦ Generate writing'}
              </button>
              <label className={`ropt ${cUseCtx ? 'on' : ''}`} title="Feeds your book's plan (and this page) into the generation">
                <input type="checkbox" checked={cUseCtx} onChange={(e) => setCUseCtx(e.target.checked)} />
                ☁ Book context
              </label>
              <span className="create-tokens" title="Total Gemini tokens this book has used">{fmtTokens(book.tokensSpent)} tokens</span>
            </div>
          </div>

          {createdImages.length > 0 && (
            <div className="asset-section">
              <h4>Recent creations</h4>
              <div className="asset-grid">
                {createdImages.slice(0, 12).map((a) => (
                  <figure key={a.id} className="asset-thumb created"
                    onClick={() => setLightbox({ src: a.imageData!, title: a.title, assetId: a.id })} title="Click to view">
                    <img src={a.imageData} alt={a.title} />
                    <figcaption>{a.title}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'notes' && (
        <div className="chat-scroll notes-list">
          {!page && (
            <div className="dump-box">
              <button className="dump-toggle" onClick={() => setDumpOpen(!dumpOpen)}>
                ≋ Brain dump {dumpOpen ? '▾' : '▸'} <span className="dump-sub">paste scattered notes — the agent files each one onto the right page</span>
              </button>
              {dumpOpen && !dumpPreview && (
                <>
                  <textarea className="dump-input" rows={6} placeholder={'- the black hole should hum a sea shanty\n- look into Suno for the score…'}
                    value={dumpText} onChange={(e) => setDumpText(e.target.value)} />
                  <button className="btn btn-gold btn-mini" disabled={busy || !dumpText.trim()} onClick={() => void runDump()}>
                    {busy ? 'Sorting…' : '⇅ Sort into the book'}
                  </button>
                </>
              )}
              {dumpOpen && dumpPreview && (
                <>
                  {dumpPreview.map((a, i) => (
                    <div key={i} className="dump-row">
                      <span className="dump-page">{a.pageTitle}</span>
                      <span className="dump-note">{a.noteText}</span>
                    </div>
                  ))}
                  <div className="nb-actions">
                    <button className="btn btn-gold btn-mini" onClick={applyDump}>Pin all {dumpPreview.length}</button>
                    <button className="btn btn-ghost btn-mini" onClick={() => setDumpPreview(null)}>← Edit</button>
                  </div>
                </>
              )}
            </div>
          )}
          {scopeNotes.length === 0 && <div className="chat-empty">No notes {page ? 'on this page' : 'in this book'} yet. Use the 📌 tool from the right-click ring, or ask the Scribe to leave one.</div>}
          {scopeNotes.map((n) => {
            const p = book.pages.find((x) => x.id === n.pageId);
            return (
              <div key={n.id} className={`noterow ${n.resolved ? 'resolved' : ''}`}>
                <button className="noterow-check" title={n.resolved ? 'Reopen' : 'Resolve'}
                  onClick={() => mutateBook(book.id, (b) => { const x = b.notes.find((y) => y.id === n.id); if (x) x.resolved = !x.resolved; })}>
                  {n.resolved ? '✓' : '○'}
                </button>
                <div className="noterow-body">
                  <div className="noterow-text">{n.text}</div>
                  {!page && p && <button className="noterow-page" onClick={() => gotoPage(p.id)}>→ {p.title}</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'logs' && (
        <div className="chat-scroll logs-list">
          {scopeLogs.length === 0 && <div className="chat-empty">Every change {page ? 'to this page' : 'in this book'} will be recorded here — drafts, canvas edits, audits, image regens, restructures.</div>}
          {scopeLogs.map((l) => {
            const p = l.pageId ? book.pages.find((x) => x.id === l.pageId) : null;
            return (
              <div key={l.id} className="logrow">
                <span className="log-ico">{LOG_ICONS[l.kind] ?? '·'}</span>
                <div className="log-body">
                  <span className="log-summary">{l.summary}</span>
                  <span className="log-meta">{ago(l.ts)}{!page && p ? <> · <button className="noterow-page" onClick={() => gotoPage(p.id)}>{p.title}</button></> : null}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'assets' && (
        <div className="chat-scroll assets-pane">
          {imageAssets.length === 0 && reportAssets.length === 0 && createdImages.length === 0 && (
            <div className="chat-empty">Every image, writing, and research report {page ? 'born on this page' : 'in this book'} collects here — from the pages, the Create atelier, and Deep research.</div>
          )}
          {reportAssets.length > 0 && (
            <div className="asset-section">
              <h4>⌕ Reports & writings</h4>
              {reportAssets.map((a) => (
                <button key={a.id} className="report-row" onClick={() => setReadAsset(a.id)}>
                  <span className="report-title">{a.title}</span>
                  <span className="log-meta">{ago(a.ts)}</span>
                </button>
              ))}
            </div>
          )}
          {(imageAssets.length > 0 || createdImages.length > 0) && (
            <div className="asset-section">
              <h4>▣ Images</h4>
              <div className="asset-grid">
                {createdImages.map((a) => (
                  <figure key={a.id} className="asset-thumb created" title={a.title}
                    onClick={() => setLightbox({ src: a.imageData!, title: a.title, assetId: a.id })}>
                    <img src={a.imageData} alt={a.title} />
                    <figcaption>✦ {a.title}</figcaption>
                  </figure>
                ))}
                {imageAssets.map(({ page: p, block: b }) => (
                  <figure key={b.id} className="asset-thumb" title={`From “${p.title}” — click to view`}
                    onClick={() => setLightbox({ src: b.imageData!, title: b.caption ?? p.title })}>
                    <img src={b.imageData} alt={b.caption ?? ''} />
                    {!page && <figcaption>{p.title}</figcaption>}
                  </figure>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* report / writing reader — available from any tab */}
      {readAsset && (() => {
        const a = (book.assets ?? []).find((x) => x.id === readAsset);
        return a ? (
          <div className="report-reader" onClick={() => setReadAsset(null)}>
            <div className="report-doc" onClick={(e) => e.stopPropagation()}>
              <h3>{a.title}</h3>
              <div className="report-content">{a.content}</div>
              <div className="nb-actions">
                <button className="btn btn-ghost btn-mini" onClick={() => {
                  mutateBook(book.id, (b) => { b.assets = (b.assets ?? []).filter((x) => x.id !== a.id); });
                  setReadAsset(null);
                }}>🗑 Discard</button>
                <button className="btn btn-gold btn-mini" onClick={() => setReadAsset(null)}>Close</button>
              </div>
            </div>
          </div>
        ) : null;
      })()}

      {/* image lightbox — view, place, download, or discard any image */}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.src} alt={lightbox.title} />
            <div className="lightbox-bar">
              <span className="lightbox-title">{lightbox.title}</span>
              <span className="lightbox-actions">
                {page && lightbox.assetId && (
                  <button className="btn btn-mini btn-gold" onClick={() => { addAssetToPage(lightbox.assetId!); setLightbox(null); }}>＋ Place on page</button>
                )}
                <a className="btn btn-mini btn-ghost" href={lightbox.src} download={`${lightbox.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`}>⤓ Download</a>
                {lightbox.assetId && (
                  <button className="btn btn-mini btn-ghost" onClick={() => {
                    mutateBook(book.id, (b) => { b.assets = (b.assets ?? []).filter((x) => x.id !== lightbox.assetId); });
                    setLightbox(null);
                    showToast('Creation discarded');
                  }}>🗑</button>
                )}
                <button className="btn btn-mini btn-ghost" onClick={() => setLightbox(null)}>✕</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

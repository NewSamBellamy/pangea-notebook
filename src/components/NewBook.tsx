/**
 * The "begin a new book" flow: a plan (detailed one-shot prompt, gated at
 * DETAIL_MIN chars, or full interview mode) → AI outline → cover art →
 * bound Book. While binding, shows an animated open-book loader PLUS a
 * live "thinking carousel" (interview-style questions generated in
 * parallel on a fast model) so the creator has something to do/answer
 * while waiting — any answers get merged into the book's plan + opening
 * book-chat message once binding completes.
 */

import React, { useRef, useState } from 'react';
import { useStore, PALETTES, SPINE_FONTS, takePendingTokens } from '../store';
import * as ai from '../ai';
import { addLog } from '../actions';
import type { Book, Page } from '../types';
import { uid } from '../types';

type Step = 'plan' | 'interview' | 'building';

const DETAIL_MIN = 120;

export function NewBook() {
  const { settings, addBook, mutateBook, setView, setFocusBook, showToast } = useStore();
  const [step, setStep] = useState<Step>('plan');
  const [prompt, setPrompt] = useState('');
  const [vibe, setVibe] = useState('');
  const [palette, setPalette] = useState(0);
  const [font, setFont] = useState(0);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [busyMsg, setBusyMsg] = useState('');
  const [error, setError] = useState('');
  // binding-screen carousel (quick path): think about your idea while the book binds
  const [carousel, setCarousel] = useState<{ qs: string[]; idx: number; answers: string[] } | null>(null);
  const [boundId, setBoundId] = useState<string | null>(null);
  const carouselRef = useRef<{ qs: string[]; answers: string[] } | null>(null);

  const canStart = prompt.trim().length > 12;
  const detailed = prompt.trim().length >= DETAIL_MIN;

  async function startInterview() {
    if (!canStart) return;
    setError('');
    setBusyMsg('The agent is preparing its sharpest questions…');
    setStep('building');
    try {
      const qs = await ai.interview(settings, prompt);
      setQuestions(qs);
      setAnswers(qs.map(() => ''));
      setStep('interview');
    } catch (e) {
      setError((e as Error).message);
      setStep('plan');
    } finally {
      setBusyMsg('');
    }
  }

  function finishToReveal(bookId: string) {
    // merge any carousel answers into the book's context
    const c = carouselRef.current;
    const answered = c ? c.qs.map((q, i) => ({ q, a: c.answers[i] ?? '' })).filter((x) => x.a.trim()) : [];
    if (answered.length) {
      mutateBook(bookId, (b) => {
        b.plan.interview = [...(b.plan.interview ?? []), ...answered];
        b.bookChat.push({
          id: uid(), role: 'user', ts: Date.now(),
          text: `While the book was binding I answered: ${answered.map((x) => `${x.q} → ${x.a}`).join(' | ')}. Fold this into how we shape the book.`,
        });
      });
      addLog((fn) => mutateBook(bookId, fn), 'toc', `Binding thoughts captured — ${answered.length} answer(s) added to the plan`);
    }
    setView('library');
    setFocusBook(bookId);
  }

  async function build(withInterview: boolean) {
    setError('');
    setStep('building');
    setBoundId(null);
    setCarousel(null);
    carouselRef.current = null;
    setBusyMsg('Researching the best structure for this project…');

    // Quick path: generate thinking questions in parallel — talk about the idea while it binds
    if (!withInterview) {
      void ai.interview(settings, prompt).then((qs) => {
        const state = { qs: qs.slice(0, 5), answers: qs.slice(0, 5).map(() => '') };
        carouselRef.current = state;
        setCarousel({ qs: state.qs, idx: 0, answers: state.answers });
      }).catch(() => { /* carousel is optional */ });
    }

    try {
      const interview = withInterview
        ? questions.map((q, i) => ({ q, a: answers[i] })).filter((x) => x.a.trim())
        : undefined;
      const outline = await ai.outline(settings, { prompt, vibe: vibe || undefined, interview });
      setBusyMsg('Designing your cover…');
      const pal = PALETTES[palette % PALETTES.length];
      const coverPrompt = `${outline.coverArt || `${prompt.slice(0, 220)} — evocative cover key art for "${outline.title}"`}. Color mood anchored in ${pal.name.toLowerCase()} tones (${pal.spine}), matching a ${pal.name.toLowerCase()} binding.`;
      let coverImage: string | undefined;
      try {
        coverImage = await ai.cover(settings, coverPrompt, palette);
      } catch { /* best-effort */ }
      setBusyMsg('Binding the book — laying out the table of contents…');
      const pages: Page[] = outline.pages.map((p) => ({
        id: uid(), chapter: p.chapter, title: p.title, summary: p.summary,
        blocks: [], annotations: [], drafted: false,
      }));
      const now = Date.now();
      const book: Book = {
        id: uid(),
        title: outline.title || 'Untitled Project',
        subtitle: outline.subtitle,
        author: settings.authorName || undefined,
        palette, font,
        createdAt: now, updatedAt: now, lastOpenedAt: now,
        coverImage, coverPrompt,
        tokensSpent: takePendingTokens(),
        plan: { prompt, vibe: vibe || undefined, interview },
        pages, notes: [], bookChat: [], pageChats: {}, researchChats: {}, logs: [], assets: [],
      };
      book.bookChat.push({
        id: uid(), role: 'model', ts: now,
        text: `Your book is bound: ${pages.length} pages across ${new Set(pages.map((x) => x.chapter)).size} parts. Open any page and I'll draft it with full knowledge of the plan — or work the whole book from here at the cover.`,
      });
      book.logs!.push({ id: uid(), ts: now, kind: 'toc', summary: `Book bound — ${pages.length} pages` });
      addBook(book);
      showToast(`"${book.title}" has been bound`);
      if (!withInterview && carouselRef.current) {
        setBoundId(book.id); // let them finish the thought, then reveal
      } else {
        setView('library');
        setFocusBook(book.id);
      }
    } catch (e) {
      setError((e as Error).message || 'Something went wrong building the outline.');
      setStep(questions.length ? 'interview' : 'plan');
    } finally {
      setBusyMsg('');
    }
  }

  return (
    <div className="newbook">
      <button className="btn btn-ghost back-btn" onClick={() => setView('library')}>← Library</button>

      {step === 'plan' && (
        <div className="nb-card">
          <button className="nb-close" title="Back to the study" onClick={() => setView('library')}>✕</button>
          <h1 className="nb-title">Every book begins with a plan.</h1>
          <p className="nb-sub">Tell the agent what you're making. A detailed paragraph unlocks the quick path — or go deeper with interview mode.</p>
          <textarea
            className="nb-prompt"
            placeholder={'e.g. A film made 100% with AI: pirates who die and get a second chance board the Argo, sail through a black hole into today’s San Francisco, and start a software company…'}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            autoFocus
          />
          <input
            className="nb-vibe"
            placeholder="Vibe / references (optional) — e.g. One Piece × Silicon Valley"
            value={vibe}
            onChange={(e) => setVibe(e.target.value)}
          />
          <div className="nb-cosmetics">
            <div className="nb-cos-group">
              <label>Binding</label>
              <div className="swatches">
                {PALETTES.map((p, i) => (
                  <button key={i} className={`swatch ${palette === i ? 'on' : ''}`}
                    style={{ background: `linear-gradient(135deg, ${p.spine}, ${p.spine2})`, boxShadow: palette === i ? `0 0 0 2px ${p.accent}` : undefined }}
                    onClick={() => setPalette(i)} title={p.name} />
                ))}
              </div>
            </div>
            <div className="nb-cos-group">
              <label>Typeface</label>
              <div className="fontpick">
                {SPINE_FONTS.map((f, i) => (
                  <button key={i} className={`fontopt ${font === i ? 'on' : ''}`} style={{ fontFamily: f }} onClick={() => setFont(i)}>Aa</button>
                ))}
              </div>
            </div>
          </div>
          {error && <div className="nb-error">{error}</div>}
          <div className="nb-actions">
            <button className="btn btn-gold" disabled={!detailed} onClick={() => void build(false)}
              title={detailed ? '' : `Write at least ${DETAIL_MIN} characters of real detail — or take the interview`}>
              ⚡ Quick outline — detailed statement, go
            </button>
            <button className="btn btn-outline" disabled={!canStart} onClick={() => void startInterview()}>
              ☕ Interview mode — outline it properly
            </button>
          </div>
          {!detailed && canStart && (
            <p className="nb-detailhint">
              A book deserves a real plan. Add {DETAIL_MIN - prompt.trim().length} more characters of detail for the quick path — or let the interview pull it out of you.
            </p>
          )}
          {!ai.isLive(settings) && (
            <p className="nb-demonote">No API key set — the book will be built in demo mode. Add a Gemini key in Settings for the real thing.</p>
          )}
        </div>
      )}

      {step === 'interview' && (
        <div className="nb-card">
          <button className="nb-close" title="Back to the study" onClick={() => setView('library')}>✕</button>
          <h1 className="nb-title">The interview.</h1>
          <p className="nb-sub">Answer what's useful, skip what isn't. Every answer sharpens the outline.</p>
          {questions.map((q, i) => (
            <div className="nb-q" key={i}>
              <label>{i + 1}. {q}</label>
              <textarea rows={2} value={answers[i]} onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))} />
            </div>
          ))}
          {error && <div className="nb-error">{error}</div>}
          <div className="nb-actions">
            <button className="btn btn-gold" onClick={() => void build(true)}>Bind the book →</button>
            <button className="btn btn-ghost" onClick={() => setStep('plan')}>← Back</button>
          </div>
        </div>
      )}

      {step === 'building' && (
        <div className="nb-building">
          {/* an opened book, pages turning */}
          <div className="binder" aria-hidden>
            <div className="binder-book">
              <div className="binder-leaf l" /><div className="binder-leaf r" />
              <div className="binder-page p1" /><div className="binder-page p2" /><div className="binder-page p3" />
              <div className="binder-quill">✒</div>
            </div>
          </div>
          <p className="binder-status">{boundId ? 'Your book is bound.' : (busyMsg || 'Working…')}</p>

          {carousel && (
            <div className="bind-carousel">
              <p className="bind-lede">{boundId ? 'One more thought before you open it?' : 'While it binds — start talking about your idea:'}</p>
              <div className="bind-q">{carousel.qs[carousel.idx]}</div>
              <textarea
                rows={3}
                placeholder="Think out loud here (optional — it gets woven into the book)…"
                value={carousel.answers[carousel.idx]}
                onChange={(e) => {
                  const next = carousel.answers.map((v, j) => (j === carousel.idx ? e.target.value : v));
                  setCarousel({ ...carousel, answers: next });
                  if (carouselRef.current) carouselRef.current.answers = next;
                }}
              />
              <div className="nb-actions bind-actions">
                {carousel.idx < carousel.qs.length - 1 && (
                  <button className="btn btn-outline btn-mini" onClick={() => setCarousel({ ...carousel, idx: carousel.idx + 1 })}>
                    Next question →
                  </button>
                )}
                {boundId && (
                  <button className="btn btn-gold" onClick={() => finishToReveal(boundId)}>
                    Open your book →
                  </button>
                )}
              </div>
              <div className="bind-dots">
                {carousel.qs.map((_, i) => <i key={i} className={i === carousel.idx ? 'on' : ''} onClick={() => setCarousel({ ...carousel, idx: i })} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

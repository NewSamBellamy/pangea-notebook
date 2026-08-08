/**
 * Gemini API key entry (+ live "Test key" validation against the models
 * list), text model choice, author name, and book import (.yok.json —
 * the counterpart to the per-book JSON export button in BookView).
 */

import React, { useRef, useState } from 'react';
import { useStore } from '../store';
import { storageMode } from '../storage';
import { testKey } from '../gemini';
import type { Book } from '../types';
import { uid } from '../types';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, setSettings, showToast, addBook } = useStore();
  const importRef = useRef<HTMLInputElement>(null);

  async function importBook(file: File) {
    try {
      const parsed = JSON.parse(await file.text()) as Book;
      if (!parsed?.title || !Array.isArray(parsed?.pages)) throw new Error('not a Pangea book file');
      parsed.id = uid(); // never collide with an existing volume
      parsed.lastOpenedAt = Date.now();
      addBook(parsed);
      showToast(`“${parsed.title}” imported to your library`);
      onClose();
    } catch (e) {
      showToast(`Import failed: ${(e as Error).message}`);
    }
  }
  const [key, setKey] = useState(settings.apiKey);
  const [author, setAuthor] = useState(settings.authorName);
  const [textModel, setTextModel] = useState(settings.textModel);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function runTest() {
    if (!key.trim() || testing) return;
    setTesting(true);
    setTestResult(null);
    const res = await testKey({ ...settings, apiKey: key.trim(), textModel });
    setTestResult(res);
    setTesting(false);
  }

  function save() {
    setSettings({ ...settings, apiKey: key.trim(), authorName: author.trim(), textModel });
    showToast(key.trim() ? 'Key saved locally — the agent is live' : 'Running in demo mode');
    onClose();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="settings" onClick={(e) => e.stopPropagation()}>
        <h3>⚙ Settings</h3>
        <label>Gemini API key <span className="set-hint">bring your own — stored only on this device ({storageMode() === 'persistent' ? 'local storage' : 'this session'})</span></label>
        <div className="set-keyrow">
          <input type="password" placeholder="AIza…" value={key} onChange={(e) => { setKey(e.target.value); setTestResult(null); }} />
          <button className="btn btn-outline" disabled={!key.trim() || testing} onClick={() => void runTest()}>
            {testing ? 'Testing…' : 'Test key'}
          </button>
        </div>
        {testResult && (
          <p className={`set-testresult ${testResult.ok ? 'ok' : 'bad'}`}>
            {testResult.ok ? '✓ ' : '✕ '}{testResult.message}
          </p>
        )}
        <p className="set-note">
          No key? Everything still works in <b>demo mode</b> — offline placeholder art and a scripted agent.
          Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">aistudio.google.com</a>.
        </p>
        <label>Writing model</label>
        <select value={textModel} onChange={(e) => setTextModel(e.target.value)}>
          <option value="gemini-flash-latest">gemini-flash-latest — fast, always current (recommended)</option>
          <option value="gemini-pro-latest">gemini-pro-latest — deepest writing</option>
          <option value="gemini-3.6-flash">gemini-3.6-flash</option>
          <option value="gemini-3.5-flash">gemini-3.5-flash</option>
        </select>
        <label>Your name <span className="set-hint">printed on your covers</span></label>
        <input placeholder="e.g. R. Vane" value={author} onChange={(e) => setAuthor(e.target.value)} />
        <label>Library</label>
        <button className="btn btn-ghost" onClick={() => importRef.current?.click()}>⤒ Import a book (.yok.json)</button>
        <input ref={importRef} type="file" hidden accept=".json,application/json"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importBook(f); e.target.value = ''; }} />
        <p className="set-note">Books export from the ⤓ button inside any open book — import them here on another device.</p>
        <div className="nb-actions">
          <button className="btn btn-gold" onClick={save}>Save</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

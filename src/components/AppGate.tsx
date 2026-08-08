/**
 * Lightweight shared-password gate for private demos (e.g. GitHub Pages).
 * This is not enterprise auth — it keeps casual visitors out of the live demo.
 * Real user accounts / cloud save still go through Supabase after unlock.
 */
import React, { useMemo, useState } from 'react';

const STORAGE_KEY = 'pangea-demo-gate-v1';

/** Demo unlock password for tomorrow. Change anytime before sharing the link. */
export const DEMO_GATE_PASSWORD = 'PangeaDemo2026';

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function AppGate({ children }: { children: React.ReactNode }) {
  const expected = useMemo(() => sha256(DEMO_GATE_PASSWORD), []);
  const [unlocked, setUnlocked] = useState(() => {
    try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (unlocked) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const got = await sha256(password.trim());
      const want = await expected;
      if (got !== want) {
        setError('That password doesn’t unlock this demo.');
        setBusy(false);
        return;
      }
      try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch { /* session-only preview */ }
      setUnlocked(true);
    } catch {
      setError('Could not verify the password in this browser.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-gate">
      <form className="app-gate-card" onSubmit={(e) => void submit(e)}>
        <div className="app-gate-mark" aria-hidden>🌍</div>
        <h1>Pangea</h1>
        <p className="app-gate-sub">Private demo access</p>
        <p className="app-gate-copy">
          This build is gated for invited walkthroughs. Enter the demo password to continue.
          Your books and account still save through your signed-in Supabase profile after unlock.
        </p>
        <label className="app-gate-label" htmlFor="demo-pass">Demo password</label>
        <input
          id="demo-pass"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter demo password"
        />
        {error && <p className="app-gate-error">{error}</p>}
        <button className="btn btn-gold" type="submit" disabled={busy || !password.trim()}>
          {busy ? 'Checking…' : 'Enter the study'}
        </button>
      </form>
    </div>
  );
}

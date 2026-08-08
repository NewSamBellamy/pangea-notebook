/**
 * Root component — StoreProvider wraps everything, Shell just renders
 * whichever top-level view is active (see store.tsx `View` type) plus the
 * always-available Settings modal and toast.
 */

import React, { useState } from 'react';
import { StoreProvider, useStore } from './store';
import { Library } from './components/Library';
import { NewBook } from './components/NewBook';
import { BookView } from './components/BookView';
import { SettingsModal } from './components/SettingsModal';
import { AppGate } from './components/AppGate';

function Shell() {
  const { view, toast } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <AppGate>
      <div className="app">
        {view === 'library' && <Library onSettings={() => setSettingsOpen(true)} />}
        {view === 'newBook' && <NewBook />}
        {view === 'book' && <BookView />}
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </AppGate>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

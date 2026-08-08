/**
 * Entry point. Renders <App /> into #root (see index.html) and pulls in
 * the single global stylesheet (styles.css).
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

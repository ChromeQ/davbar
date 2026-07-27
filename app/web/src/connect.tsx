import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './common.style.css';
import './connect.style.css';

const Connect = () => (
  <main className="connect-shell">
    <header className="connect-header">
      <p className="eyebrow">DavBar</p>
      <h1>Configure WiFi</h1>
    </header>

    <form className="connect-form" action="/connect" method="post">
      <label className="connect-field">
        <span>SSID</span>
        <input name="ssid" type="text" required autoComplete="username" />
      </label>

      <label className="connect-field">
        <span>Password</span>
        <input name="password" type="password" required autoComplete="current-password" />
      </label>

      <button className="connect-submit" type="submit">
        Save
      </button>
    </form>
  </main>
);

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <Connect />
  </StrictMode>
);

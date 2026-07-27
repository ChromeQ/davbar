import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Eye, EyeOff } from 'lucide-react';

import './common.style.css';
import './connect.style.css';

const Connect = () => {
  const [passwordVisible, setPasswordVisible] = useState(false);

  return (
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

        <div className="connect-field">
          <label htmlFor="password">Password</label>
          <div className="password-input">
            <input
              id="password"
              name="password"
              type={passwordVisible ? 'text' : 'password'}
              required
              autoComplete="current-password"
            />
            <button
              className="password-toggle"
              type="button"
              aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              aria-pressed={passwordVisible}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </div>

        <button className="connect-submit" type="submit">
          Save
        </button>
      </form>
    </main>
  );
};

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(
  <StrictMode>
    <Connect />
  </StrictMode>
);

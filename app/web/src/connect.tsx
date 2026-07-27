import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  LockOpen,
  RefreshCw,
} from 'lucide-react';

import './common.style.css';
import './connect.style.css';

type Network = {
  ssid: string;
  rssi: number;
  secure: boolean;
};

type ConnectionResult = {
  success: boolean;
  message: string;
};

const isNetwork = (value: unknown): value is Network =>
  typeof value === 'object' &&
  value !== null &&
  'ssid' in value &&
  typeof value.ssid === 'string' &&
  'rssi' in value &&
  typeof value.rssi === 'number' &&
  'secure' in value &&
  typeof value.secure === 'boolean';

const isConnectionResult = (value: unknown): value is ConnectionResult =>
  typeof value === 'object' &&
  value !== null &&
  'success' in value &&
  typeof value.success === 'boolean' &&
  'message' in value &&
  typeof value.message === 'string';

const Connect = () => {
  const initialScanStarted = useRef(false);
  const networkDropdownRef = useRef<HTMLDivElement>(null);
  const [networks, setNetworks] = useState<Network[]>([]);
  const [selectedSsid, setSelectedSsid] = useState('');
  const [networkDropdownOpen, setNetworkDropdownOpen] = useState(false);
  const [activeNetworkIndex, setActiveNetworkIndex] = useState(-1);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);

  const scanNetworks = async () => {
    setScanning(true);
    setScanError('');
    setSelectedSsid('');
    setNetworkDropdownOpen(false);
    setPassword('');
    setPasswordVisible(false);
    setConnectionResult(null);

    try {
      const response = await fetch('/scan');

      if (!response.ok) {
        throw new Error(`Scan failed with status ${response.status}.`);
      }

      const data: unknown = await response.json();

      if (
        typeof data !== 'object' ||
        data === null ||
        !('networks' in data) ||
        !Array.isArray(data.networks)
      ) {
        throw new Error('Scan returned an invalid response.');
      }

      setNetworks(data.networks.filter(isNetwork));
    } catch (error) {
      setNetworks([]);
      setScanError(error instanceof Error ? error.message : 'Unable to scan for WiFi networks.');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (initialScanStarted.current) {
      return;
    }

    initialScanStarted.current = true;
    void scanNetworks();
  }, []);

  useEffect(() => {
    const closeDropdown = (event: PointerEvent) => {
      if (!networkDropdownRef.current?.contains(event.target as Node)) {
        setNetworkDropdownOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeDropdown);

    return () => document.removeEventListener('pointerdown', closeDropdown);
  }, []);

  const selectNetwork = (ssid: string) => {
    setSelectedSsid(ssid);
    setNetworkDropdownOpen(false);
    setPassword('');
    setPasswordVisible(false);
    setConnectionResult(null);
  };

  const selectedNetwork = networks.find((network) => network.ssid === selectedSsid);
  const dropdownDisabled = scanning || connecting || networks.length === 0;
  const passwordRequired = selectedNetwork?.secure === true;
  const saveDisabled =
    connecting || !selectedNetwork || (passwordRequired && password.length === 0);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (saveDisabled) {
      return;
    }

    setConnecting(true);
    setNetworkDropdownOpen(false);
    setConnectionResult(null);

    try {
      const response = await fetch('/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          ssid: selectedSsid,
          password,
        }),
      });
      const responseBody = await response.text();

      if (!responseBody) {
        throw new Error('The device closed the connection without returning a response.');
      }

      let result: unknown;

      try {
        result = JSON.parse(responseBody);
      } catch {
        throw new Error('The device returned an invalid response.');
      }

      if (!isConnectionResult(result)) {
        throw new Error('The device returned an invalid response.');
      }

      setConnectionResult(result);

      if (result.success) {
        window.setTimeout(() => window.close(), 2000);
      }
    } catch (error) {
      setConnectionResult({
        success: false,
        message: error instanceof Error ? error.message : 'Unable to test the WiFi connection.',
      });
    } finally {
      setConnecting(false);
    }
  };

  const openNetworkDropdown = () => {
    if (dropdownDisabled) {
      return;
    }

    const selectedIndex = networks.findIndex((network) => network.ssid === selectedSsid);
    setActiveNetworkIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setNetworkDropdownOpen(true);
  };

  const handleNetworkKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (dropdownDisabled) {
      return;
    }

    if (event.key === 'Escape') {
      setNetworkDropdownOpen(false);
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();

      if (networkDropdownOpen) {
        const activeNetwork = networks[activeNetworkIndex];

        if (activeNetwork) {
          selectNetwork(activeNetwork.ssid);
        }
      } else {
        openNetworkDropdown();
      }

      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();

      if (!networkDropdownOpen) {
        openNetworkDropdown();
        return;
      }

      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveNetworkIndex(
        (currentIndex) => (currentIndex + direction + networks.length) % networks.length
      );
    }
  };

  return (
    <main className="connect-shell">
      <header className="connect-header">
        <p className="eyebrow">DavBar</p>
        <h1>Configure WiFi</h1>
      </header>

      <form className="connect-form" action="/connect" method="post" onSubmit={handleSubmit}>
        <div className="connect-field">
          <div className="connect-field-heading">
            <span id="wifi-network-label">WiFi network</span>
            <button
              className="rescan-button"
              type="button"
              disabled={scanning || connecting}
              onClick={() => void scanNetworks()}
            >
              <RefreshCw className={scanning ? 'scan-spinner' : ''} size={15} />
              {scanning ? 'Scanning' : 'Rescan'}
            </button>
          </div>
          <div className="network-dropdown" ref={networkDropdownRef}>
            <input name="ssid" type="hidden" value={selectedSsid} />
            <button
              className="network-dropdown-trigger"
              type="button"
              role="combobox"
              aria-labelledby="wifi-network-label"
              aria-controls="wifi-network-options"
              aria-expanded={networkDropdownOpen}
              aria-activedescendant={
                networkDropdownOpen && activeNetworkIndex >= 0
                  ? `network-option-${activeNetworkIndex}`
                  : undefined
              }
              disabled={dropdownDisabled}
              onClick={() =>
                networkDropdownOpen ? setNetworkDropdownOpen(false) : openNetworkDropdown()
              }
              onKeyDown={handleNetworkKeyDown}
            >
              <span className={selectedNetwork ? 'network-name' : 'network-placeholder'}>
                {selectedNetwork
                  ? selectedNetwork.ssid
                  : scanning
                    ? 'Scanning for networks…'
                    : networks.length === 0
                      ? 'No networks found'
                      : 'Select a network'}
              </span>
              <ChevronDown
                className={networkDropdownOpen ? 'dropdown-chevron is-open' : 'dropdown-chevron'}
                size={18}
                aria-hidden="true"
              />
            </button>
            {networkDropdownOpen && (
              <div
                className="network-options"
                id="wifi-network-options"
                role="listbox"
                onMouseLeave={() => {
                  const selectedIndex = networks.findIndex(
                    (network) => network.ssid === selectedSsid
                  );
                  setActiveNetworkIndex(selectedIndex);
                }}
              >
                {networks.map((network, index) => {
                  const SecurityIcon = network.secure ? Lock : LockOpen;

                  return (
                    <div
                      className={`network-option ${index === activeNetworkIndex ? 'is-active' : ''}`}
                      id={`network-option-${index}`}
                      key={network.ssid}
                      role="option"
                      aria-selected={network.ssid === selectedSsid}
                      onMouseEnter={() => setActiveNetworkIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectNetwork(network.ssid)}
                    >
                      <SecurityIcon size={16} strokeWidth={1.8} aria-hidden="true" />
                      <span>{network.ssid}</span>
                      <span className="network-signal">{network.rssi} dBm</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {scanError && (
            <p className="scan-error" role="alert">
              {scanError}
            </p>
          )}
        </div>

        <div className="connect-field">
          <label htmlFor="password">Password</label>
          <div className="password-input">
            <input
              id="password"
              name="password"
              type={passwordVisible ? 'text' : 'password'}
              value={password}
              required={passwordRequired}
              disabled={!passwordRequired || connecting}
              autoComplete="current-password"
              onChange={(event) => {
                setPassword(event.target.value);
                setConnectionResult(null);
              }}
            />
            <button
              className="password-toggle"
              type="button"
              disabled={!passwordRequired || connecting}
              aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              aria-pressed={passwordVisible}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              {passwordVisible ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
          </div>
        </div>

        <button className="connect-submit" type="submit" disabled={saveDisabled}>
          {connecting ? (
            <>
              <LoaderCircle className="connect-spinner" size={18} aria-hidden="true" />
              Connecting
            </>
          ) : (
            'Save'
          )}
        </button>
        {connectionResult && (
          <p
            className={`connection-message ${connectionResult.success ? 'is-success' : 'is-error'}`}
            role={connectionResult.success ? 'status' : 'alert'}
          >
            {connectionResult.success ? (
              <CheckCircle2 size={18} aria-hidden="true" />
            ) : (
              <CircleAlert size={18} aria-hidden="true" />
            )}
            <span>{connectionResult.message}</span>
          </p>
        )}
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

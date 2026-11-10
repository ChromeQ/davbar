// The tap badge in the header, which opens a menu linking to the other taps' pages.
// The taps come from the profiles in config/ (see app/scripts/device-config.ts).
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

import type { TapLink } from './device-config';

type TapSwitcherProps = {
  deviceName: string;
  deviceId: string;
  taps: TapLink[];
};

export const TapSwitcher = ({ deviceName, deviceId, taps }: TapSwitcherProps) => {
  const [open, setOpen] = useState(false);
  const switcherRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Closes on a click outside it, or Escape.
  useEffect(() => {
    if (!open) {
      return;
    }

    const closeOutside = (event: PointerEvent) => {
      if (!switcherRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  // Nothing to switch to: just the badge.
  if (taps.length < 2) {
    return <span className="tap-badge">{deviceName}</span>;
  }

  return (
    <span className="tap-switcher" ref={switcherRef}>
      <button
        ref={buttonRef}
        className="tap-badge"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="tap-menu"
        title="Switch to another tap"
        onClick={() => setOpen(!open)}
      >
        {deviceName}
        <ChevronDown className="tap-switcher-chevron" aria-hidden="true" />
      </button>
      {open && (
        <ul id="tap-menu" className="tap-menu" aria-label="Taps">
          {taps.map((tap) =>
            tap.deviceId === deviceId ? (
              <li key={tap.deviceId}>
                <span aria-current="page">
                  {tap.deviceName}
                  <Check size={16} aria-label="this tap" />
                </span>
              </li>
            ) : (
              <li key={tap.deviceId}>
                <a href={tap.url}>{tap.deviceName}</a>
              </li>
            )
          )}
        </ul>
      )}
    </span>
  );
};

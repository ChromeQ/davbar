import { Pipette } from 'lucide-react';
import type { ReactNode } from 'react';

// The screen's own 6 colours. These come out clean on the screen, while any
// other colour is mixed from dots of these.
export const SCREEN_COLOURS = [
  { name: 'White', hex: '#ffffff' },
  { name: 'Black', hex: '#000000' },
  { name: 'Yellow', hex: '#ffff00' },
  { name: 'Red', hex: '#ff0000' },
  { name: 'Blue', hex: '#0000ff' },
  { name: 'Green', hex: '#00ff00' },
];

// Chrome's eyedropper picks a colour from anywhere on the screen. Only desktop
// Chrome and Edge have it, so it's looked up rather than assumed.
type EyeDropperConstructor = new () => { open: () => Promise<{ sRGBHex: string }> };

const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper;

type ColourPickerProps = {
  label: string;
  value: string;
  onChange: (colour: string) => void;
  // Given when there's an image to take a colour from. Without Chrome's
  // eyedropper, the button turns picking from the image on and off instead.
  pickingFromImage?: boolean;
  onPickFromImage?: (picking: boolean) => void;
  // More buttons at the end of the row.
  children?: ReactNode;
};

// A colour input, the screen's colours as swatches and an eyedropper button.
export const ColourPicker = ({
  label,
  value,
  onChange,
  pickingFromImage = false,
  onPickFromImage,
  children,
}: ColourPickerProps) => {
  const pick = async () => {
    if (pickingFromImage || !EyeDropper) {
      onPickFromImage?.(!pickingFromImage);
      return;
    }

    try {
      const result = await new EyeDropper().open();
      onChange(result.sRGBHex);
    } catch (error) {
      // Escape cancels it: keep the colour. Any other failure means the
      // eyedropper can't work here, so pick from the image instead.
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        onPickFromImage?.(true);
      }
    }
  };

  const eyedropperTitle = EyeDropper
    ? 'Pick a colour from anywhere on the screen'
    : 'Take a colour from the image';

  return (
    <div className="colour-picker">
      <span className="colour-picker-label">{label}</span>
      <div className="colour-picker-row">
        <input
          type="color"
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {SCREEN_COLOURS.map((colour) => (
          <button
            key={colour.hex}
            className="colour-swatch"
            type="button"
            style={{ background: colour.hex }}
            aria-label={`${colour.name}, clean on the screen`}
            aria-pressed={value.toLowerCase() === colour.hex}
            title={`${colour.name}, clean on the screen`}
            onClick={() => onChange(colour.hex)}
          />
        ))}
        {(EyeDropper || onPickFromImage) && (
          <button
            className="eyedropper-button"
            type="button"
            aria-label={eyedropperTitle}
            aria-pressed={onPickFromImage ? pickingFromImage : undefined}
            title={eyedropperTitle}
            onClick={() => void pick()}
          >
            <Pipette size={16} aria-hidden="true" />
          </button>
        )}
        {children}
      </div>
    </div>
  );
};

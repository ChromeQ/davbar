import { ArrowUpDown } from 'lucide-react';

import { ColourPicker } from './colour-picker';
import {
  backgroundColours,
  isGradient,
  type Background,
  type BackgroundColour,
  type BackgroundStyle,
} from './screen';

type BackgroundPickerProps = {
  value: Background;
  onChange: (background: Background) => void;
  // For an image: offers the blurred image, and lets the eyedropper buttons take
  // a colour from the image. picking is the colour being picked, if any.
  forImage?: boolean;
  picking?: BackgroundColour | null;
  onPick?: (colour: BackgroundColour | null) => void;
};

const STYLES: Array<{ value: BackgroundStyle; label: string }> = [
  { value: 'solid', label: 'Solid colour' },
  { value: 'linear', label: 'Linear gradient' },
  { value: 'radial', label: 'Radial gradient' },
  { value: 'blur', label: 'Blurred image' },
];

// The background for text mode, or for the gaps around an image: its style, and
// its colour or its gradient's two colours.
export const BackgroundPicker = ({
  value,
  onChange,
  forImage = false,
  picking = null,
  onPick,
}: BackgroundPickerProps) => {
  const styles = STYLES.filter((style) => forImage || style.value !== 'blur');
  const colours = backgroundColours(value.style);

  const changeStyle = (style: string) => {
    const chosen = styles.find((option) => option.value === style);

    if (chosen) {
      onChange({ ...value, style: chosen.value });
    }
  };

  const pickProps = (colour: BackgroundColour) =>
    onPick && {
      pickingFromImage: picking === colour,
      onPickFromImage: (on: boolean) => onPick(on ? colour : null),
    };

  return (
    <div className="background-picker">
      <label className="text-field background-style-field">
        <span>Background</span>
        <select value={value.style} onChange={(event) => changeStyle(event.target.value)}>
          {styles.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
      </label>
      {colours.includes('colour') && (
        <ColourPicker
          label={isGradient(value.style) ? 'Start colour' : 'Background colour'}
          value={value.colour}
          onChange={(colour) => onChange({ ...value, colour })}
          {...pickProps('colour')}
        />
      )}
      {colours.includes('endColour') && (
        <ColourPicker
          label="End colour"
          value={value.endColour}
          onChange={(endColour) => onChange({ ...value, endColour })}
          {...pickProps('endColour')}
        >
          <button
            className="reverse-gradient-button"
            type="button"
            aria-label="Swap the start and end colours"
            title="Swap the start and end colours"
            onClick={() => onChange({ ...value, colour: value.endColour, endColour: value.colour })}
          >
            <ArrowUpDown size={16} aria-hidden="true" />
          </button>
        </ColourPicker>
      )}
      {picking && (
        <p className="fit-hint">
          Click the image to take a colour from it, or press Escape to stop.
        </p>
      )}
    </div>
  );
};

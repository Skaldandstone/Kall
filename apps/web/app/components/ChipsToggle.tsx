'use client';

import { useState } from 'react';
import styles from './ChipsInput.module.css';
import toggleStyles from './ChipsToggle.module.css';

type Option = { value: string; label: string };

type Props = {
  name: string;
  label: string;
  options: Option[];
  defaultValue?: string[];
  helpText?: string;
};

/** A fixed set of options rendered as togglable chips (click to select/
 * deselect), for fields like work arrangement or work type where free text
 * doesn't make sense. Keeps a hidden comma-joined input under `name` so
 * existing FormData-based submit handlers work unchanged. */
export default function ChipsToggle({ name, label, options, defaultValue = [], helpText }: Props) {
  const [selected, setSelected] = useState<string[]>(defaultValue);

  function toggle(value: string) {
    setSelected((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  return (
    <fieldset className={toggleStyles.fieldset}>
      <legend>{label}</legend>
      <input type="hidden" name={name} value={selected.join(',')} />
      <div className={toggleStyles.row}>
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              type="button"
              key={option.value}
              className={`${styles.chip} ${toggleStyles.toggle} ${active ? toggleStyles.active : ''}`}
              aria-pressed={active}
              onClick={() => toggle(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {helpText && <small>{helpText}</small>}
    </fieldset>
  );
}

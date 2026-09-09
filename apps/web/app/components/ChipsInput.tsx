'use client';

import { KeyboardEvent, useId, useState } from 'react';
import styles from './ChipsInput.module.css';

type Props = {
  name?: string;
  label: string;
  placeholder?: string;
  helpText?: string;
  defaultValue?: string[];
  required?: boolean;
  className?: string;
  /** Optional autocomplete options (e.g. known cities) shown while typing.
   * Freeform entries outside this list are still accepted. */
  suggestions?: string[];
  value?: string[];
  onChange?: (value: string[]) => void;
  autoFocus?: boolean;
};

/** A free-text "type and press Enter/comma to add" chip field. Keeps a
 * hidden comma-joined input under `name` so existing FormData-based submit
 * handlers (`csv(form.get(name))`) work unchanged -- only the display
 * changes from a raw text box to removable chips. */
export default function ChipsInput({ name, label, placeholder, helpText, defaultValue = [], required, className, suggestions, value, onChange, autoFocus }: Props) {
  const id = useId();
  const [internalChips, setInternalChips] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState('');
  const chips = value ?? internalChips;

  function updateChips(update: (current: string[]) => string[]) {
    const next = update(chips);
    if (value === undefined) setInternalChips(next);
    onChange?.(next);
  }

  function commitDraft() {
    const nextValues = draft.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean);
    setDraft('');
    if (!nextValues.length) return;
    updateChips((current) => [...current, ...nextValues.filter((item) => !current.includes(item))]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitDraft();
    } else if (event.key === 'Backspace' && !draft && chips.length > 0) {
      updateChips((current) => current.slice(0, -1));
    }
  }

  function removeChip(value: string) {
    updateChips((current) => current.filter((chip) => chip !== value));
  }

  return (
    <label htmlFor={id}>
      {label}
      {name ? <input type="hidden" name={name} value={chips.join(',')} /> : null}
      <div className={`${styles.field} ${className || ''}`}>
        {chips.map((chip) => (
          <span className={styles.chip} key={chip}>
            {chip}
            <button type="button" aria-label={`Remove ${chip}`} onClick={() => removeChip(chip)}>
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          autoFocus={autoFocus}
          className={styles.draft}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitDraft}
          placeholder={chips.length === 0 ? placeholder : ''}
          required={required && chips.length === 0}
          list={suggestions ? `${id}-suggestions` : undefined}
        />
        {suggestions && (
          <datalist id={`${id}-suggestions`}>
            {suggestions.map((option) => (
              <option value={option} key={option} />
            ))}
          </datalist>
        )}
      </div>
      {helpText && <small>{helpText}</small>}
    </label>
  );
}

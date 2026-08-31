/** Empty means unset; zero is a real preference, including zero travel. */
export function optionalProfileNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : Number(text);
}

import { useEffect, useState } from 'react';

export type NudgeTheme = 'light' | 'dark';
const KEY = 'nudgeTheme';
const valid = (value: unknown): value is NudgeTheme => value === 'light' || value === 'dark';

export function useSharedTheme() {
  const [theme, setTheme] = useState<NudgeTheme>(() =>
    typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );
  const [error, setError] = useState<string>();
  useEffect(() => {
    document.documentElement.dataset.nudgeTheme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  useEffect(() => {
    if (typeof browser === 'undefined') return;
    let active = true;
    let changedSinceRead = false;
    const changed = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'local' && valid(changes[KEY]?.newValue)) {
        changedSinceRead = true;
        setTheme(changes[KEY].newValue);
      }
    };
    browser.storage.onChanged.addListener(changed);
    void browser.storage.local
      .get(KEY)
      .then((saved) => {
        if (active && !changedSinceRead && valid(saved[KEY])) setTheme(saved[KEY]);
      })
      .catch(() => setError('Could not load your saved appearance.'));
    return () => {
      active = false;
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setError(undefined);
    if (typeof browser !== 'undefined')
      void browser.storage.local
        .set({ [KEY]: next })
        .catch(() => setError('Appearance changed here, but could not be saved.'));
  };
  return { theme, toggle, error };
}

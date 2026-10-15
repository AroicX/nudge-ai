import { useEffect, useRef } from 'react';

export function useOnChange<T>(value: T, onChange: (current: T, previous: T) => void) {
  const previous = useRef(value);
  useEffect(() => {
    if (!Object.is(previous.current, value)) onChange(value, previous.current);
    previous.current = value;
  }, [onChange, value]);
}

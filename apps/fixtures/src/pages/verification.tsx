import { useState } from 'react';

export function VerificationFixture() {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  return (
    <main>
      <header>
        <p className="eyebrow">Nudge test verification</p>
        <h1>Enter your verification code</h1>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
        }}
      >
        <label>
          One-time code
          <input
            autoComplete="one-time-code"
            inputMode="numeric"
            maxLength={6}
            value={value}
            onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </label>
        <button type="submit">Confirm code</button>
      </form>
      <p aria-live="polite">Input length: {value.length}</p>
      <p aria-live="polite">Submitted: {submitted ? 'yes' : 'no'}</p>
    </main>
  );
}

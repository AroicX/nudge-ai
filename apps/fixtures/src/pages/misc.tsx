import { useEffect, useState } from 'react';

export function LongScrollFixture() {
  const [y, setY] = useState(0);
  useEffect(() => {
    const update = () => setY(Math.round(window.scrollY));
    window.addEventListener('scroll', update);
    return () => window.removeEventListener('scroll', update);
  }, []);
  return (
    <main className="long-scroll" style={{ height: 20_000 }}>
      <header>
        <p className="eyebrow">Nudge test reader</p>
        <h1>A very long article</h1>
      </header>
      <p className="scroll-readout" aria-live="polite">
        Scroll position: {y}
      </p>
      {Array.from({ length: 40 }, (_, index) => (
        <p key={index} style={{ marginTop: 400 }}>
          Section {index + 1}: lorem ipsum dolor sit amet.
        </p>
      ))}
    </main>
  );
}

export function FlakyFixture() {
  const [ready, setReady] = useState(false);
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1_500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <main>
      <h1>Slow results</h1>
      {ready ? (
        <>
          <p>{clicks >= 2 ? 'Loaded 10 more results' : '10 results'}</p>
          <button type="button" onClick={() => setClicks((count) => count + 1)}>
            Load more
          </button>
        </>
      ) : (
        <p>Loading…</p>
      )}
    </main>
  );
}

export function BlockerFixture() {
  const [step, setStep] = useState<'form' | 'challenge'>('form');
  const [email, setEmail] = useState('');
  return (
    <main>
      <h1>Join our newsletter</h1>
      {step === 'form' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setStep('challenge');
          }}
        >
          <label>
            Email address
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <button type="submit">Continue</button>
        </form>
      ) : (
        <section aria-label="Human verification">
          <h2>Verify you are human</h2>
          <label>
            <input type="checkbox" /> I'm not a robot
          </label>
          <p>Complete the check to finish signing up.</p>
        </section>
      )}
    </main>
  );
}

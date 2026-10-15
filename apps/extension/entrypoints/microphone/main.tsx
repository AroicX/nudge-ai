import { Mic, CheckCircle2 } from 'lucide-react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { probeMicrophone, type MicrophoneState } from '../../src/permissions/microphone';
import '../../src/styles/app.css';

function MicrophoneSetup() {
  const [state, setState] = useState<MicrophoneState>();
  const request = async () => {
    const next = await probeMicrophone();
    setState(next);
    if (next === 'granted') {
      await browser.storage.local.set({ microphoneSetupCompleted: true });
    }
  };

  return (
    <main className="permission-page">
      <section className="permission-card">
        <span className="permission-card__icon">
          {state === 'granted' ? <CheckCircle2 /> : <Mic />}
        </span>
        <h1>Let Nudge hear you</h1>
        <p>
          Chrome requires you to approve microphone access once. Nudge only records while you are
          dictating or in a voice call.
        </p>
        {state === 'granted' ? (
          <>
            <p className="permission-card__success">Microphone ready</p>
            <button type="button" onClick={() => window.close()}>
              Return to Nudge
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void request()}>
            Allow microphone
          </button>
        )}
        {state && state !== 'granted' ? (
          <p role="alert">
            {state === 'denied'
              ? 'Microphone access is blocked. Allow it in Chrome site settings, then try again.'
              : state === 'dismissed'
                ? 'The request was dismissed. Click Allow microphone when you are ready.'
                : 'No working microphone was found.'}
          </p>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MicrophoneSetup />
  </StrictMode>,
);

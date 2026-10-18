import { describe, expect, it, vi } from 'vitest';
import {
  localBrowserInstruction,
  LocalVoiceConversation,
  SpeechSegmenter,
  SpokenPhrases,
} from './local-voice';

describe('local voice', () => {
  it('segments speech after silence and discards short noise', () => {
    const vad = new SpeechSegmenter(1000);
    expect(vad.push(new Float32Array(100).fill(0.2))).toMatchObject({ started: false });
    expect(vad.push(new Float32Array(200).fill(0.2))).toMatchObject({ started: true });
    expect(vad.push(new Float32Array(1800))).toHaveProperty('audio');
    const noise = new SpeechSegmenter(1000);
    noise.push(new Float32Array(100).fill(0.2));
    expect(noise.push(new Float32Array(1800))).not.toHaveProperty('audio');
  });
  it('aborts an in-flight reply on interruption and ignores stale results', async () => {
    let resolve!: (text: string) => void;
    const speech = vi.fn();
    const chat = vi.fn(
      (_messages: unknown, _signal: AbortSignal) =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const events = vi.fn();
    const voice = new LocalVoiceConversation(
      { health: async () => ({ available: true }), transcribe: async () => 'hello', chat, speech },
      events,
      {
        capture: async () => () => {},
        play: async () => {},
      },
    );
    await voice.start();
    voice.sendText('hello');
    voice.interrupt();
    resolve('stale response');
    await Promise.resolve();
    expect(speech).not.toHaveBeenCalled();
    expect(chat.mock.calls[0]?.[1]?.aborted).toBe(true);
    await voice.end();
  });
  it('closes a microphone acquired after ending the call', async () => {
    let resolve!: (stop: () => void) => void;
    const stop = vi.fn();
    const voice = new LocalVoiceConversation(
      {
        health: async () => ({ available: true }),
        transcribe: vi.fn(),
        chat: vi.fn(),
        speech: vi.fn(),
      },
      vi.fn(),
      {
        capture: () =>
          new Promise((done) => {
            resolve = done;
          }),
        play: async () => {},
      },
    );
    const starting = voice.start();
    await vi.waitFor(() => expect(resolve).toBeDefined());
    await voice.end();
    resolve(stop);
    await starting;
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe('local browser activation', () => {
  it.each([
    'Open YouTube',
    'Please open youtube.com',
    'Can you open YouTube?',
    'Go to github.com',
    'Click the search button',
    'Scroll down',
    'Search the web for headphones',
    'Notch, open YouTube',
  ])('routes the direct browser request %s without a required wake word', (text) => {
    expect(localBrowserInstruction(text, false)).toBe(
      text.startsWith('Notch, ') ? 'open YouTube' : text,
    );
  });
  it.each([
    'cool.',
    'Notch.',
    'How do I open YouTube?',
    'Do not open YouTube',
    'Tell me what "open YouTube" means',
    'Can you open websites?',
    'Can you find a nice story?',
  ])('keeps conversational speech out of browser execution: %s', (text) => {
    expect(localBrowserInstruction(text, false)).toBeUndefined();
  });
  it('forwards an unprefixed spoken Open YouTube request to the browser instead of conversational Qwen', async () => {
    let frame!: (samples: Float32Array, rate: number) => void;
    const browserTask = vi.fn();
    const chat = vi.fn();
    const voice = new LocalVoiceConversation(
      {
        health: async () => ({ available: true }),
        transcribe: async () => 'Open YouTube',
        chat,
        speech: vi.fn(),
      },
      vi.fn(),
      {
        capture: async (callback) => {
          frame = callback;
          return () => {};
        },
        play: async () => {},
      },
      (text) => {
        const instruction = localBrowserInstruction(text, false);
        if (!instruction) return false;
        browserTask(instruction);
        return true;
      },
    );
    await voice.start();
    frame(new Float32Array(300).fill(0.1), 1000);
    frame(new Float32Array(1800), 1000);
    await vi.waitFor(() => expect(browserTask).toHaveBeenCalledWith('Open YouTube'));
    expect(chat).not.toHaveBeenCalled();
    await voice.end();
  });
  it('requires a deliberate prefix or an exact control during a task', () => {
    expect(localBrowserInstruction('Nudge, find a kettle', false)).toBe('find a kettle');
    expect(localBrowserInstruction('Can you find a nice story?', true)).toBeUndefined();
    expect(localBrowserInstruction('stop', false)).toBeUndefined();
    expect(localBrowserInstruction('Stop.', true)).toBe('Stop.');
    expect(localBrowserInstruction('pause and tell me a joke', true)).toBeUndefined();
  });
  it('does not run conversational inference for an explicitly routed browser instruction', async () => {
    const chat = vi.fn();
    const instruction = vi.fn(() => true);
    const voice = new LocalVoiceConversation(
      { health: async () => ({ available: true }), transcribe: vi.fn(), chat, speech: vi.fn() },
      vi.fn(),
      {
        capture: async () => () => {},
        play: async () => {},
      },
      instruction,
    );
    await voice.start();
    voice.sendText('Nudge, open a tab');
    await Promise.resolve();
    expect(instruction).toHaveBeenCalledWith('Nudge, open a tab');
    expect(chat).not.toHaveBeenCalled();
    await voice.end();
  });
  it('automatically transcribes a speech segment and plays the conversational reply', async () => {
    let frame!: (samples: Float32Array, rate: number) => void;
    const transcribe = vi.fn(async (_audio: Blob, _signal: AbortSignal) => 'hello');
    const chat = vi.fn(async () => 'Hello there.');
    const speech = vi.fn(async () => new Blob(['wav']));
    const play = vi.fn(async () => {});
    const events = vi.fn();
    const voice = new LocalVoiceConversation(
      { health: async () => ({ available: true }), transcribe, chat, speech },
      events,
      {
        capture: async (callback) => {
          frame = callback;
          return () => {};
        },
        play,
      },
    );
    await voice.start();
    frame(new Float32Array(300).fill(0.1), 1000);
    frame(new Float32Array(1800), 1000);
    await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
    expect(transcribe.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'speech.stopped', role: 'assistant' }),
    );
    await voice.end();
  });
  it('does not capture or infer when health is unavailable', async () => {
    const capture = vi.fn();
    const events = vi.fn();
    const voice = new LocalVoiceConversation(
      {
        health: async () => ({ available: false, error: 'Install voice models' }),
        transcribe: vi.fn(),
        chat: vi.fn(),
        speech: vi.fn(),
      },
      events,
      { capture, play: vi.fn() },
    );
    await voice.start();
    expect(capture).not.toHaveBeenCalled();
    expect(voice.state).toBe('failed');
    expect(events).toHaveBeenCalledWith({ type: 'error', message: 'Install voice models' });
  });
});

describe('local voice lifecycle and limits', () => {
  it('keeps the latest utterance within backend per-message and history limits', async () => {
    const { boundedLocalHistory } = await import('./local-voice');
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? ('assistant' as const) : ('user' as const),
      content: `${index}:` + 'x'.repeat(3200),
    }));
    const history = boundedLocalHistory([
      ...messages,
      { role: 'user', content: 'latest'.repeat(1000) },
    ]);
    expect(history.at(-1)?.content).toBe('latest'.repeat(1000).slice(0, 4000));
    expect(history.reduce((sum, message) => sum + message.content.length, 0)).toBeLessThanOrEqual(
      10000,
    );
    expect(history.every((message) => message.content.length <= 4000)).toBe(true);
    expect(history.length).toBeLessThan(messages.length);
  });

  it('discards muted and stale microphone frames across restarts', async () => {
    const frames: Array<(samples: Float32Array, rate: number) => void> = [];
    const transcribe = vi.fn(async () => 'hello');
    const stop = vi.fn();
    const voice = new LocalVoiceConversation(
      {
        health: async () => ({ available: true }),
        transcribe,
        chat: vi.fn(async () => 'Hi'),
        speech: vi.fn(async () => new Blob()),
      },
      vi.fn(),
      {
        capture: async (callback) => {
          frames.push(callback);
          return stop;
        },
        play: async () => {},
      },
    );
    const utterance = (index: number) => {
      frames[index]!(new Float32Array(300).fill(0.2), 1000);
      frames[index]!(new Float32Array(1800), 1000);
    };
    await voice.start();
    voice.setMuted(true);
    utterance(0);
    expect(transcribe).not.toHaveBeenCalled();
    await voice.end();
    await voice.start();
    utterance(0);
    expect(transcribe).not.toHaveBeenCalled();
    utterance(1);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    await voice.end();
    expect(stop).toHaveBeenCalledTimes(2);
  });
});

it('speaks the first streamed sentence before Qwen finishes and cancels the rest on interruption', async () => {
  let finish!: (text: string) => void;
  const speech = vi.fn(async () => new Blob(['wav']));
  const play = vi.fn(async () => {});
  const voice = new LocalVoiceConversation(
    {
      health: async () => ({ available: true }),
      transcribe: vi.fn(),
      chat: vi.fn(),
      speech,
      chatStream: async (_messages, _signal, onText) => {
        onText('Hello Gabriel. ');
        return new Promise<string>((resolve) => {
          finish = resolve;
        });
      },
    },
    vi.fn(),
    { capture: async () => () => {}, play },
  );
  await voice.start();
  voice.sendText('Hi');
  await vi.waitFor(() => expect(play).toHaveBeenCalledOnce());
  expect(speech).toHaveBeenCalledWith('Hello Gabriel.', expect.any(AbortSignal));
  voice.interrupt();
  finish('Hello Gabriel. How are you?');
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(speech).toHaveBeenCalledTimes(1);
  await voice.end();
});

it('does not open the microphone when a call ends during model preparation', async () => {
  let ready!: () => void;
  const capture = vi.fn(async () => () => {});
  const voice = new LocalVoiceConversation(
    {
      health: async () => ({ available: true }),
      transcribe: vi.fn(),
      chat: vi.fn(),
      speech: vi.fn(),
      prepare: () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    },
    vi.fn(),
    { capture, play: vi.fn() },
  );
  const starting = voice.start();
  await vi.waitFor(() => expect(ready).toBeDefined());
  await voice.end();
  ready();
  await starting;
  expect(capture).not.toHaveBeenCalled();
});

it('prefetches only one spoken phrase ahead and discards it when the call ends', async () => {
  let release!: () => void;
  const speech = vi.fn(async () => new Blob(['wav']));
  const play = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const voice = new LocalVoiceConversation(
    {
      health: async () => ({ available: true }),
      transcribe: vi.fn(),
      chat: vi.fn(),
      speech,
      chatStream: async (_messages, _signal, onText) => {
        onText('First sentence. Second sentence. Third sentence. ');
        return 'First sentence. Second sentence. Third sentence.';
      },
    },
    vi.fn(),
    { capture: async () => () => {}, play },
  );
  await voice.start();
  voice.sendText('Hello');
  await vi.waitFor(() => expect(speech).toHaveBeenCalledTimes(2));
  expect(play).toHaveBeenCalledTimes(1);
  await voice.end();
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(speech).toHaveBeenCalledTimes(2);
  expect(play).toHaveBeenCalledTimes(1);
});

it.each([
  'Find me a black iPhone 16.',
  'Please find a black iPhone on this website.',
  "I meant on the current page I'm looking at. Find me a black iPhone 16.",
  'Look for a black phone on this site',
  'Can you show me the cheapest iPhone on this page?',
  'Sure, open YouTube.',
  'Search for black iPhones',
])('routes browser task language to the task controller: %s', (text) => {
  expect(localBrowserInstruction(text, false)).toBe(text);
});
it.each([
  'Find me a nice story',
  'Tell me about black iPhones',
  'What does find me an iPhone mean?',
  'Do not find me an iPhone',
])('does not execute conversation or negation: %s', (text) => {
  expect(localBrowserInstruction(text, false)).toBeUndefined();
});

it.each([
  'in 10 minutes, open youtube.com',
  'Fill this contact form with my saved name and email',
  'Complete the application using my CV',
  'Apply for this job using my profile',
  'Type Gabriel into the name field',
  'tomorrow at 9:30 am, open github.com',
  'schedule a meeting on my calendar tomorrow at 9 am',
  'book an appointment on my calendar for tomorrow',
])('routes scheduling and calendar requests to the browser: %s', (text) => {
  expect(localBrowserInstruction(text, false)).toBe(text);
});

describe('incremental local speech', () => {
  it('keeps a short hesitation and an unfinished request in one utterance', () => {
    const vad = new SpeechSegmenter(1000);
    vad.push(new Float32Array(300).fill(0.1));
    expect(vad.push(new Float32Array(1000))).not.toHaveProperty('audio');
    vad.push(new Float32Array(1300).fill(0.1));
    vad.setTranscript('Can you');
    expect(vad.push(new Float32Array(1500))).not.toHaveProperty('audio');
    vad.push(new Float32Array(700).fill(0.1));
    vad.setTranscript('Can you open the website');
    expect(vad.push(new Float32Array(1100))).toHaveProperty('audio');
  });
  it('retains bounded pre-roll without accumulating isolated noise into speech', () => {
    const vad = new SpeechSegmenter(1000);
    for (let n = 0; n < 20; n++) {
      expect(vad.push(new Float32Array(100).fill(0.2)).started).toBe(false);
      expect(vad.push(new Float32Array(300)).started).toBe(false);
    }
    expect(vad.push(new Float32Array(300).fill(0.2)).started).toBe(true);
    const result = vad.push(new Float32Array(1800));
    expect(result.audio!.size).toBe(44 + (300 + 300 + 1800) * 2);
  });
  it('publishes replacement partials under one utterance ID and commits only the final text', async () => {
    let frame!: (samples: Float32Array, rate: number) => void;
    const events = vi.fn();
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce('Can you')
      .mockResolvedValueOnce('Can you open')
      .mockResolvedValueOnce('Can you open YouTube');
    const instruction = vi.fn(() => true);
    const voice = new LocalVoiceConversation(
      { health: async () => ({ available: true }), transcribe, chat: vi.fn(), speech: vi.fn() },
      events,
      {
        capture: async (cb) => {
          frame = cb;
          return () => {};
        },
        play: async () => {},
      },
      instruction,
    );
    await voice.start();
    frame(new Float32Array(2000).fill(0.1), 1000);
    await vi.waitFor(() =>
      expect(events.mock.calls.some(([e]) => e.type === 'transcript' && !e.final)).toBe(true),
    );
    frame(new Float32Array(2000).fill(0.1), 1000);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(events.mock.calls.filter(([e]) => e.type === 'transcript')).toHaveLength(2),
    );
    frame(new Float32Array(2200), 1000);
    await vi.waitFor(() => expect(instruction).toHaveBeenCalledWith('Can you open YouTube'));
    const transcripts = events.mock.calls.map(([e]) => e).filter((e) => e.type === 'transcript');
    expect(transcripts).toHaveLength(3);
    expect(transcripts.slice(0, 2).every((e) => e.replace === true && !e.final)).toBe(true);
    expect(new Set(transcripts.map((e) => e.itemId)).size).toBe(1);
    expect(transcripts.filter((e) => e.final)).toHaveLength(1);
    await voice.end();
  });
  it('keeps one STT job and prioritizes final audio over queued partial snapshots', async () => {
    let frame!: (samples: Float32Array, rate: number) => void;
    let release!: (text: string) => void;
    const transcribe = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue('Final complete request');
    const events = vi.fn();
    const instruction = vi.fn(() => true);
    const voice = new LocalVoiceConversation(
      { health: async () => ({ available: true }), transcribe, chat: vi.fn(), speech: vi.fn() },
      events,
      {
        capture: async (cb) => {
          frame = cb;
          return () => {};
        },
        play: async () => {},
      },
      instruction,
    );
    await voice.start();
    frame(new Float32Array(2000).fill(0.1), 1000);
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    for (let n = 0; n < 4; n++) frame(new Float32Array(2000).fill(0.1), 1000);
    frame(new Float32Array(1800), 1000);
    expect(transcribe).toHaveBeenCalledOnce();
    expect(transcribe.mock.calls[0]![1].aborted).toBe(true);
    release('stale partial');
    await vi.waitFor(() => expect(instruction).toHaveBeenCalledWith('Final complete request'));
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(events.mock.calls.filter(([e]) => e.type === 'transcript').map(([e]) => e.text)).toEqual(
      ['Final complete request'],
    );
    await voice.end();
  });
  it('starts the first bounded clause before the whole answer is available', () => {
    const phrases = new SpokenPhrases();
    const first =
      'I can help you find the right information, and we can check the details together';
    expect(phrases.push(first)).toEqual(['I can help you find the right information,']);
    expect(phrases.push('.', true)).toEqual(['and we can check the details together.']);
  });
});

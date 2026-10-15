export function LiveTranscript({ text }: { text: string }) {
  return text ? (
    <p className="live-transcript" aria-live="polite">
      {text}
    </p>
  ) : null;
}

export function Status({ value }: { value: string }) {
  return (
    <p className="status" aria-live="polite">
      {value}
    </p>
  );
}

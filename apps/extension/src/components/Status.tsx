import { TextShimmer } from '../../components/nexus-ui/text-shimmer';

export function Status({ value }: { value: string }) {
  const active = value.endsWith('…');
  return (
    <p className="status" aria-live="polite">
      {active ? <TextShimmer>{value}</TextShimmer> : value}
    </p>
  );
}

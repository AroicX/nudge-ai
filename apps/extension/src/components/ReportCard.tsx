import type { FinalReport } from '@nudge/contracts';

const TITLES: Record<FinalReport['outcome'], string> = {
  completed: 'Done',
  partially_completed: 'Partly done',
  failed: 'Could not finish',
  cancelled: 'Stopped',
};

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="task-card__section">
      <h3>{title}</h3>
      <ul>
        {items.map((item, index) => (
          <li key={`${index}:${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ReportCard({ report }: { report: FinalReport }) {
  return (
    <section className={`task-card task-card--report task-card--${report.outcome}`} aria-label="Task result">
      <h2>{TITLES[report.outcome]}</h2>
      <p>{report.summary}</p>
      <Section title="Verified" items={report.verified} />
      <Section title="Still to do" items={report.partial} />
      <Section title="Done but not verified" items={report.unverified} />
      <Section title="Skipped" items={report.skipped.map((entry) => `${entry.item} — ${entry.reason}`)} />
      {report.sources.length ? (
        <div className="task-card__section">
          <h3>Sources</h3>
          <ul className="task-card__sources">
            {report.sources.map((source) => (
              <li key={source}>
                <a href={source} target="_blank" rel="noreferrer">
                  {host(source)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

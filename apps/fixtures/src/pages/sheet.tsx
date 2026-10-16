import { useRef, useState, type KeyboardEvent } from 'react';

const COLUMNS = ['A', 'B', 'C', 'D', 'E'];
const ROWS = 12;

export function SheetFixture() {
  const [values, setValues] = useState<Record<string, string>>({ A1: 'Title', B1: 'Company', C1: 'Location', D1: 'Salary', E1: 'Source' });
  const [active, setActive] = useState('A2');
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  const move = (cell: string, dx: number, dy: number) => {
    const column = COLUMNS.indexOf(cell[0]!);
    const row = Number(cell.slice(1));
    const next = `${COLUMNS[Math.min(Math.max(column + dx, 0), COLUMNS.length - 1)]}${Math.min(Math.max(row + dy, 1), ROWS)}`;
    setActive(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (cell: string) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      move(cell, event.shiftKey ? -1 : 1, 0);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      move(`A${cell.slice(1)}`, 0, 1);
    }
  };

  const filledRows = new Set(
    Object.entries(values)
      .filter(([cell, value]) => value.trim() && Number(cell.slice(1)) > 1)
      .map(([cell]) => cell.slice(1)),
  ).size;

  return (
    <main className="sheet">
      <header>
        <p className="eyebrow">Nudge test spreadsheet</p>
        <h1>Job tracker</h1>
      </header>
      <p aria-live="polite">
        Active cell {active}: {values[active] ?? ''} · Rows filled: {filledRows}
      </p>
      <div role="grid" aria-label="Job tracker grid" className="grid">
        {Array.from({ length: ROWS }, (_, rowIndex) => (
          <div role="row" key={rowIndex} className="grid-row">
            {COLUMNS.map((column) => {
              const cell = `${column}${rowIndex + 1}`;
              return (
                <div
                  key={cell}
                  role="gridcell"
                  aria-label={cell}
                  contentEditable
                  suppressContentEditableWarning
                  tabIndex={0}
                  ref={(node) => {
                    refs.current[cell] = node;
                  }}
                  onFocus={() => setActive(cell)}
                  onKeyDown={onKeyDown(cell)}
                  onInput={(event) => {
                    const text = event.currentTarget.textContent ?? '';
                    setValues((current) => ({ ...current, [cell]: text }));
                  }}
                >
                  {rowIndex === 0 ? values[cell] : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </main>
  );
}

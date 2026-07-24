import type { DataHealth } from '../../../shared/ipc-types';

function dumpAgeDays(value: string | null): number | null {
  if (!value) return null;
  // Accept both ISO and SQLite-canonical 'YYYY-MM-DD HH:MM:SS' (treated as UTC).
  const ms = Date.parse(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(ms) ? null : (Date.now() - ms) / 86_400_000;
}

export function DataHealthFooter({ health }: { health: DataHealth | null }) {
  const age = dumpAgeDays(health?.dumpImportedAt ?? null);
  const ageClass = age === null ? 'red' : age < 2 ? 'green' : age < 7 ? 'yellow' : 'red';
  const eddnClass = health?.eddn.status === 'connected' ? 'green' : health?.eddn.status === 'stopped' ? 'red' : 'yellow';
  return (
    <footer className="footer">
      {health?.error && (
        <>
          <span className="dot red" />
          <span data-testid="engine-error" className="error" style={{ margin: 0 }}>{health.error}</span>
        </>
      )}
      <span className={`dot ${ageClass}`} />
      <span data-testid="dump-age">
        {age === null
          ? 'No market database — run the import-dump CLI'
          : `Market data: ${age < 1 ? 'imported today' : `${Math.floor(age)}d old`}`}
      </span>
      <span className={`dot ${eddnClass}`} />
      <span data-testid="eddn">
        EDDN {health?.eddn.status ?? '…'} · {health?.eddn.applied ?? 0} live updates
      </span>
      <span className={`dot ${health?.journalFile ? 'green' : 'red'}`} />
      <span data-testid="journal">{health?.journalFile ? 'Journal linked' : 'No journal found'}</span>
    </footer>
  );
}

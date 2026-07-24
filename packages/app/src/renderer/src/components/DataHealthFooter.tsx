import type { DataHealth } from '../../../shared/ipc-types';

function timeOfDay(iso: string | null): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function DataHealthFooter({
  health,
  onToggleEddn,
}: {
  health: DataHealth | null;
  onToggleEddn: (next: boolean) => void;
}) {
  const spansh = health?.spansh;
  const eddn = health?.eddn;
  return (
    <footer className="footer">
      {health?.error && (
        <>
          <span className="dot red" />
          <span data-testid="engine-error" className="error" style={{ margin: 0 }}>{health.error}</span>
        </>
      )}
      <span className={`dot ${spansh?.reachable ? 'green' : 'red'}`} />
      <span data-testid="spansh">
        {spansh?.reachable
          ? `Spansh ✓${spansh.lastSuccessAt ? ` · checked ${timeOfDay(spansh.lastSuccessAt)}` : ''}`
          : `Spansh unreachable${spansh?.lastError ? ` — ${spansh.lastError}` : ''}`}
      </span>
      <span className={`dot ${eddn?.enabled ? 'green' : 'yellow'}`} />
      <span
        data-testid="eddn"
        style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
        title="Click to toggle EDDN broadcasting"
        onClick={() => onToggleEddn(!(eddn?.enabled ?? true))}
      >
        {eddn?.enabled
          ? `Broadcasting · ${eddn.sent} sent${eddn.dropped > 0 ? ` · ${eddn.dropped} dropped` : ''}`
          : 'Broadcast off'}
      </span>
      <span className={`dot ${health?.journalFile ? 'green' : 'red'}`} />
      <span data-testid="journal">{health?.journalFile ? 'Journal linked' : 'No journal found'}</span>
    </footer>
  );
}

/**
 * Normalize a timestamp to SQLite's canonical UTC format ('YYYY-MM-DD HH:MM:SS')
 * so values from Spansh dumps ('2026-07-01 12:00:00+00') and EDDN messages
 * ('2026-07-23T02:00:00Z') are string-comparable with datetime('now', ...).
 */
export function toSqliteUtc(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim();
  if (/^\d{4}-\d{2}-\d{2} /.test(v)) v = v.replace(' ', 'T');
  if (/[+-]\d{2}$/.test(v)) v = v + ':00';
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.16em] text-[var(--ink-3)]">{label}</dt>
      <dd className="mt-1 break-all text-[var(--ink-1)]">{value}</dd>
    </div>
  );
}

import { countingNotes, getCountingSnapshot } from "../utils/counting";

export function CountingSummary({ snapshot }: { snapshot: unknown }) {
  const data = getCountingSnapshot(snapshot);
  if (!data) return <p className="mt-3 text-xs text-slate-500">No establishment reconciliation details were included in this report.</p>;
  const notes = countingNotes(data);
  return (
    <section aria-label="Establishment counting basis" className="mt-4 space-y-2 rounded-xl border border-emerald-200 p-4 text-xs leading-6 dark:border-emerald-300/20">
      <h3 className="font-semibold">Saved establishment counting basis</h3>
      {notes.slice(0, 3).map((note) => (
        <p key={note}>{note}</p>
      ))}
      <details>
        <summary className="cursor-pointer font-semibold">Camera evidence and snapshot</summary>
        {notes.slice(3).map((note) => (
          <p key={note} className="mt-2 break-words">
            {note}
          </p>
        ))}
      </details>
    </section>
  );
}

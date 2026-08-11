type SupplementaryNotesProps = {
  isReadOnly: boolean;
  notes: string;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
};

export function SupplementaryNotes({ isReadOnly, notes, setNotes }: SupplementaryNotesProps) {
  return (
    <div>
      <label className="mb-2 block text-xs font-semibold tracking-wider text-[#111827] uppercase">Supplementary Data</label>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        disabled={isReadOnly}
        className="min-h-24 w-full resize-y rounded-xl border border-gray-300 bg-white p-3.5 text-sm text-[#111827] shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none focus:border-[#065f46] disabled:bg-gray-50 disabled:text-gray-600"
        placeholder="Add notes regarding events, closures, or demographic estimates..."
      ></textarea>
    </div>
  );
}

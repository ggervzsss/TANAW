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
        className="min-h-20 w-full resize-none rounded-sm border border-gray-300 p-3 text-sm text-[#111827] outline-none focus:border-[#065f46] disabled:bg-gray-50 disabled:text-gray-600"
        placeholder="Add notes regarding events, closures, or demographic estimates..."
      ></textarea>
    </div>
  );
}

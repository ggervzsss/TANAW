import { useId } from "react";

type SupplementaryNotesProps = {
  isReadOnly: boolean;
  notes: string;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
};

export function SupplementaryNotes({ isReadOnly, notes, setNotes }: SupplementaryNotesProps) {
  const id = useId();
  return (
    <div className="report-notes">
      <label htmlFor={id}>Supplementary Data</label>
      <textarea
        id={id}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        disabled={isReadOnly}
        placeholder="Add notes regarding events, closures, or demographic estimates..."
      ></textarea>
    </div>
  );
}

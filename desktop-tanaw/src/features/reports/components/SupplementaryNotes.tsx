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
      {/* On screen it reads "Optional" under the visitor table; screen readers hear "Report notes, Optional". */}
      <label htmlFor={id}>
        <span className="sr-only">Report notes, </span>
        Optional
      </label>
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

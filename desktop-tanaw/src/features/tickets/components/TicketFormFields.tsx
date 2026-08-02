import type { ReactNode } from "react";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { ticketFieldClassName } from "../utils/ticket-form-style";

type TicketPanelHeaderProps = {
  actions?: ReactNode;
  icon: ReactNode;
  subtitle: string;
  title: string;
};

export function TicketPanelHeader({ actions, icon, subtitle, title }: TicketPanelHeaderProps) {
  return (
    <div className="enterprise-ticket-panel-header border-b border-emerald-100 px-6 py-5 dark:border-slate-600">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80 dark:bg-emerald-500/12 dark:text-emerald-200 dark:ring-emerald-300/20">
            {icon}
          </span>
          <div>
            <h3 className="text-sm font-black tracking-wide text-[#111827] uppercase dark:text-white">{title}</h3>
            <p className="mt-1 text-xs font-semibold text-gray-500 dark:text-slate-200">{subtitle}</p>
          </div>
        </div>
        {actions}
      </div>
    </div>
  );
}

type InputFieldProps = {
  error?: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

export function InputField({ error, label, name, onChange, placeholder, value }: InputFieldProps) {
  const errorId = `ticket-${name}-error`;
  return (
    <label data-field-name={name} className="block scroll-mt-28">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-200">{label}</span>
      <input
        type="text"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={ticketFieldClassName()}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        data-form-error-focus
      />
      {error ? <TicketFieldError id={errorId} message={error} /> : null}
    </label>
  );
}

type SelectFieldProps = {
  error?: string;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
};

export function SelectField({ error, label, name, onChange, options, value }: SelectFieldProps) {
  const errorId = `ticket-${name}-error`;
  return (
    <div data-field-name={name} className="block scroll-mt-28">
      <span className="mb-2 block text-xs font-bold tracking-wider text-gray-500 uppercase dark:text-slate-200">{label}</span>
      <SelectDropdown value={value} onChange={onChange} options={options} ariaLabel={label} ariaInvalid={Boolean(error)} ariaDescribedBy={error ? errorId : undefined} focusOnFormError />
      {error ? <TicketFieldError id={errorId} message={error} /> : null}
    </div>
  );
}

export function TicketFieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1.5 text-xs font-semibold text-red-700 dark:text-red-200">
      {message}
    </p>
  );
}

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
    <div className="enterprise-ticket-panel-header flex min-h-16 flex-col justify-end pb-4">
      <div className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-[0.9375rem] leading-snug font-semibold text-(--tanaw-text) [&_svg]:text-(--tanaw-accent-ink)">
            {icon}
            {title}
          </h3>
          <p className="mt-1 text-[0.8125rem] text-(--tanaw-text-secondary)">{subtitle}</p>
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
      <span className="mb-1.5 block text-sm font-semibold text-(--tanaw-text-secondary)">{label}</span>
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
      <span className="mb-1.5 block text-sm font-semibold text-(--tanaw-text-secondary)">{label}</span>
      <SelectDropdown value={value} onChange={onChange} options={options} ariaLabel={label} ariaInvalid={Boolean(error)} ariaDescribedBy={error ? errorId : undefined} focusOnFormError />
      {error ? <TicketFieldError id={errorId} message={error} /> : null}
    </div>
  );
}

export function TicketFieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="tanaw-enter mt-1.5 text-[0.8125rem] font-semibold text-(--tanaw-error)">
      {message}
    </p>
  );
}

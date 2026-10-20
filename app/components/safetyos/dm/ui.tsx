'use client';

import { useId, type ReactNode } from 'react';
import { PhotoField } from './photo';

/**
 * The small parts every DM module is made of.
 *
 * The console is a vanilla design mounted in this page, so these controls are plain inputs
 * with `dm-` classes rather than the design's own: the form has to stay readable even if
 * the design's stylesheet changes underneath it.
 */

export function Field({
  label, value, onChange, type = 'text', placeholder, hint, wide, maxLength, list
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'time' | 'number';
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  maxLength?: number;
  /** Id of a datalist the input suggests from — the shared employee master lists. */
  list?: string;
}) {
  const id = useId();
  return <label className={`dm-field${wide ? ' is-wide' : ''}`} htmlFor={id}>
    <span>{label}</span>
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      list={list}
      onChange={(event) => onChange(event.target.value)}
    />
    {hint && <small>{hint}</small>}
  </label>;
}

export function Area({
  label, value, onChange, rows = 2, wide = true
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  wide?: boolean;
}) {
  const id = useId();
  return <label className={`dm-field${wide ? ' is-wide' : ''}`} htmlFor={id}>
    <span>{label}</span>
    <textarea id={id} rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
  </label>;
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="dm-toggle">
    <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    <span>{label}</span>
  </label>;
}

export function Pick({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  const id = useId();
  return <label className="dm-field" htmlFor={id}>
    <span>{label}</span>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  </label>;
}

export type Column<T> = {
  key: keyof T & string;
  label: string;
  /** `photo` renders the one-button photo field; the value is a data URL. */
  kind?: 'text' | 'select' | 'check' | 'photo';
  options?: readonly string[];
  width?: string;
};

/**
 * A photo field for the modules that hold one photo rather than a table of rows.
 *
 * The same one-button photo control as the table cells, with a label above it so a stacked
 * card on a phone still says what the picture is evidence of.
 */
export function PhotoFieldBox({
  label, value, onChange
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return <div className="dm-photo-field">
    <span className="dm-photo-field-label">{label}</span>
    <PhotoField value={value} onChange={onChange} />
  </div>;
}

/**
 * A table whose rows the operator can add and remove.
 *
 * `blank` is a factory, not a shared object: two rows pointing at the same object would
 * edit each other.
 */
export function RowsTable<T extends Record<string, unknown>>({
  columns, rows, onChange, blank, addLabel, minRows = 1
}: {
  columns: Column<T>[];
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: () => T;
  addLabel: string;
  minRows?: number;
}) {
  const update = (index: number, key: keyof T & string, value: unknown) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  };

  return <div className="dm-rows">
    <div className="dm-rows-scroll">
      <table className="dm-table">
        <thead>
          <tr>
            <th className="dm-rownum">#</th>
            {columns.map((column) => <th key={column.key} style={column.width ? { width: column.width } : undefined}>{column.label}</th>)}
            <th className="dm-rowact" />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={columns.length + 2} className="dm-empty">No rows yet.</td></tr>}
          {rows.map((row, index) => <tr key={index}>
            <td className="dm-rownum">{index + 1}</td>
            {columns.map((column) => <td key={column.key} data-label={column.label}>
              {column.kind === 'photo'
                ? <PhotoField
                  value={String(row[column.key] ?? '')}
                  onChange={(photo) => update(index, column.key, photo)}
                />
                : column.kind === 'check'
                ? <input
                  type="checkbox"
                  checked={Boolean(row[column.key])}
                  onChange={(event) => update(index, column.key, event.target.checked)}
                />
                : column.kind === 'select'
                  ? <select
                    value={String(row[column.key] ?? '')}
                    onChange={(event) => update(index, column.key, event.target.value)}
                  >
                    {(column.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  : <input
                    value={String(row[column.key] ?? '')}
                    onChange={(event) => update(index, column.key, event.target.value)}
                  />}
            </td>)}
            <td className="dm-rowact">
              <button
                type="button"
                className="dm-remove"
                aria-label={`Remove row ${index + 1}`}
                disabled={rows.length <= minRows}
                onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
              >×</button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <button type="button" className="dm-addrow" onClick={() => onChange([...rows, blank()])}>+ {addLabel}</button>
  </div>;
}

/** One numbered module of the eleven, collapsible, with a "done" hint in the header. */
export function Module({ index, title, summary, open, onToggle, children }: {
  index: number;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return <section className={`dm-module${open ? ' is-open' : ''}`}>
    <button type="button" className="dm-module-head" aria-expanded={open} onClick={onToggle}>
      <span className="dm-module-index">{index}</span>
      <span className="dm-module-title">
        {title}
        <small>{summary}</small>
      </span>
      <span className="dm-module-caret" aria-hidden>{open ? '−' : '+'}</span>
    </button>
    {open && <div className="dm-module-body">{children}</div>}
  </section>;
}

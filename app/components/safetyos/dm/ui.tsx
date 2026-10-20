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

/* ------------------------------------------------------------------ *
 * Phone rows
 * ------------------------------------------------------------------ *
 * On a phone a nine-column table is unreadable and collapsing it with CSS turned a row into
 * a card whose labels were visible but whose fields were not. These are real cards instead:
 * a bordered box per row, a labelled box per field, and a remove button in the row header.
 * The desktop table is untouched and stays the desktop rendering.
 */

/**
 * One labelled field inside a phone row card.
 *
 * The visible box is the wrapper `div`, not the input: a browser that styles inputs into
 * nothing (which is what the phone did to the old table cells) still leaves an outlined,
 * filled box here, with the field inside it.
 */
export function CardField({
  label, hint, boxed = true, children
}: {
  label: string;
  hint?: string;
  /** Off for controls that bring their own chrome — the photo field, mainly. */
  boxed?: boolean;
  children: ReactNode;
}) {
  return <div className="dm-cfield">
    <span>{label}</span>
    <div className={boxed ? 'dm-cfield-box' : 'dm-cfield-plain'}>{children}</div>
    {hint && <small>{hint}</small>}
  </div>;
}

/** The frame one row becomes on a phone: a number, a remove button, then the fields. */
export function RowCard({
  index, label, onRemove, canRemove = true, children
}: {
  index: number;
  label: string;
  onRemove: () => void;
  canRemove?: boolean;
  children: ReactNode;
}) {
  return <article className="dm-rowcard">
    <header className="dm-rowcard-head">
      <span className="dm-rowcard-no">{label} {index + 1}</span>
      <button
        type="button"
        className="dm-rowcard-remove"
        aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
        disabled={!canRemove}
        onClick={onRemove}
      >×</button>
    </header>
    <div className="dm-rowcard-body">{children}</div>
  </article>;
}

/** A text input styled for a phone card — full width, thumb height, no inherited size. */
export function CardInput({
  value, onChange, placeholder, maxLength, list, label, type = 'text'
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  list?: string;
  label: string;
  type?: 'text' | 'date' | 'time' | 'number';
}) {
  return <input
    className="dm-cinput"
    type={type}
    value={value}
    placeholder={placeholder}
    maxLength={maxLength}
    list={list}
    aria-label={label}
    onChange={(event) => onChange(event.target.value)}
  />;
}

export function CardSelect({
  value, onChange, options, label, blank
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  label: string;
  /** An extra empty option, for a select that has not been answered yet. */
  blank?: string;
}) {
  return <select
    className="dm-cinput"
    value={value}
    aria-label={label}
    onChange={(event) => onChange(event.target.value)}
  >
    {blank !== undefined && <option value="">{blank}</option>}
    {options.map((option) => <option key={option} value={option}>{option}</option>)}
  </select>;
}

/**
 * A table whose rows the operator can add and remove.
 *
 * `blank` is a factory, not a shared object: two rows pointing at the same object would
 * edit each other.
 *
 * `phone` renders the same rows as cards instead of a table. It is driven by the form's
 * layout hook rather than a media query because these are two different trees, not two
 * styles of the same one.
 */
export function RowsTable<T extends Record<string, unknown>>({
  columns, rows, onChange, blank, addLabel, minRows = 1, phone = false
}: {
  columns: Column<T>[];
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: () => T;
  addLabel: string;
  minRows?: number;
  phone?: boolean;
}) {
  const update = (index: number, key: keyof T & string, value: unknown) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [key]: value } : row)));
  };
  const remove = (index: number) => onChange(rows.filter((_, rowIndex) => rowIndex !== index));

  if (phone) {
    return <div className="dm-rows">
      {rows.length === 0 && <p className="dm-empty-state">No rows yet — “{addLabel}” se pehli row add karein.</p>}
      {rows.map((row, index) => <RowCard
        key={index}
        index={index}
        label={addLabel.replace(/^Add /, '').replace(/^(.)/, (letter) => letter.toUpperCase())}
        onRemove={() => remove(index)}
        canRemove={rows.length > minRows}
      >
        {columns.map((column) => <CardField key={column.key} label={column.label} boxed={column.kind !== 'photo'}>
          {column.kind === 'photo'
            ? <PhotoField
              value={String(row[column.key] ?? '')}
              onChange={(photo) => update(index, column.key, photo)}
            />
            : column.kind === 'select'
              ? <CardSelect
                label={column.label}
                value={String(row[column.key] ?? '')}
                options={column.options ?? []}
                onChange={(value) => update(index, column.key, value)}
              />
              : column.kind === 'check'
                ? <input
                  className="dm-cinput"
                  type="checkbox"
                  checked={Boolean(row[column.key])}
                  aria-label={column.label}
                  onChange={(event) => update(index, column.key, event.target.checked)}
                />
                : <CardInput
                  label={column.label}
                  value={String(row[column.key] ?? '')}
                  onChange={(value) => update(index, column.key, value)}
                />}
        </CardField>)}
      </RowCard>)}
      <button type="button" className="dm-addrow" onClick={() => onChange([...rows, blank()])}>
        + {addLabel}
      </button>
    </div>;
  }

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
export function Module({ index, title, summary, open, onToggle, locked = false, children }: {
  index: number;
  title: string;
  summary: string;
  open: boolean;
  onToggle?: () => void;
  /** Phone stepper: one module on screen, so its head is a label rather than a fold control. */
  locked?: boolean;
  children: ReactNode;
}) {
  const head = (
    <>
      <span className="dm-module-index">{index}</span>
      <span className="dm-module-title">
        {title}
        <small>{summary}</small>
      </span>
      {!locked && <span className="dm-module-caret" aria-hidden>{open ? '−' : '+'}</span>}
    </>
  );

  return <section className={`dm-module${open ? ' is-open' : ''}${locked ? ' is-step' : ''}`}>
    {locked
      ? <div className="dm-module-head is-static">{head}</div>
      : <button type="button" className="dm-module-head" aria-expanded={open} onClick={onToggle}>{head}</button>}
    {open && <div className="dm-module-body">{children}</div>}
  </section>;
}

import { screen } from '@testing-library/react';

/** A table's own header cells: never those of a table nested inside one of its cells. */
const headerCells = (table: Element) =>
  table.querySelectorAll(':scope > [role="row"] > [role="columnheader"]');

/**
 * #318: a spanning cell names the span of its OWN table's header row. The
 * header cells are counted here, never typed, so a column added to or removed
 * from a header row without moving the spans fails.
 *
 * Returns how many spanning cells it checked: a caller pins that number, so a
 * state that renders no spanning cell cannot pass by checking nothing.
 */
export function expectSpansMatchHeaders(): number {
  const spans = Array.from(document.querySelectorAll('[role="cell"][aria-colspan]'));
  for (const cell of spans) {
    const table = cell.closest('[role="table"]');
    expect(table).not.toBeNull();
    expect(cell).toHaveAttribute('aria-colspan', String(table && headerCells(table).length));
  }
  return spans.length;
}

/**
 * #318: every table's column headers, in order, one list per table. A header
 * only assistive technology reads is wrapped in parentheses: `(Actions)`.
 */
export function headerLabels(): string[][] {
  return screen
    .getAllByRole('table')
    .map((table) =>
      Array.from(headerCells(table), (header) =>
        header.querySelector('.srOnly') === null
          ? (header.textContent ?? '')
          : `(${header.textContent ?? ''})`
      )
    );
}

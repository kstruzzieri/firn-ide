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
    const headers = cell
      .closest('[role="table"]')
      ?.querySelectorAll(':scope > [role="row"] > [role="columnheader"]').length;
    expect(cell).toHaveAttribute('aria-colspan', String(headers));
  }
  return spans.length;
}

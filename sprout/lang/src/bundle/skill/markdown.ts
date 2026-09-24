// The Markdown the generated skill is written in (the spec's The compiler
// › The generated skill): headings, fenced code, tables and inline code.
// Every cell and span is escaped here, so what a table of the compiler's
// reads as a table whatever words it holds.

/** `text` as inline code, fenced with enough backticks that one inside cannot close it. */
export function code(text: string): string {
  const runs = text.match(/`+/g) ?? [];
  const longest = runs.reduce((most, run) => Math.max(most, run.length), 0);
  const fence = '`'.repeat(longest + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
}

/** A fenced block of `text` in `language`, fenced longer than any run of backticks inside it. */
export function fenced(language: string, text: string): string {
  const runs = text.match(/`{3,}/g) ?? [];
  const longest = runs.reduce((most, run) => Math.max(most, run.length), 2);
  const fence = '`'.repeat(longest + 1);
  const body = text.endsWith('\n') ? text : `${text}\n`;
  return `${fence}${language}\n${body}${fence}`;
}

/** One cell's text: on one line, with a `|` that would end the cell escaped. */
function cell(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');
}

/** A table: a header row, the rule under it, and one row for each of `rows`. */
export function table(head: readonly string[], rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]): string => `| ${cells.map(cell).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

/** A heading at `level`, one `#` for the page's title. */
export function heading(level: number, text: string): string {
  return `${'#'.repeat(level)} ${text}`;
}

/** Blocks joined into one page, a blank line between each. */
export function blocks(...parts: readonly string[]): string {
  return parts.filter((part) => part.length > 0).join('\n\n');
}

/** `a, b and c`, or `a, b or c`, as a sentence lists them. */
export function listed(items: readonly string[], joined: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items[0] ?? 'nothing';
  return `${items.slice(0, -1).join(', ')} ${joined} ${items.at(-1)}`;
}

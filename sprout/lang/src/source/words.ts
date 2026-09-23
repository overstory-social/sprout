// Words a diagnostic lists (the spec's The compiler › Diagnostics): a
// list is written out the way a person reads one, so that a message
// names what it names in one voice wherever it is raised.

/** A list written out the way a person reads one: `a`, `a and b`, `a, b and c`; `nothing` for none. */
export function readable(words: readonly string[]): string {
  if (words.length === 0) return 'nothing';
  if (words.length === 1) return `\`${words[0]}\``;
  const all = words.map((word) => `\`${word}\``);
  return `${all.slice(0, -1).join(', ')} and ${all.at(-1)}`;
}

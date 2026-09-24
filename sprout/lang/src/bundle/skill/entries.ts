// A table of the generated skill's, held against the compiler's own list
// of words (the spec's The compiler › The generated skill: it "cannot
// describe a language the compiler does not implement"). The skill lists
// what the compiler's list holds, in its order, and never an entry the
// compiler lacks; a word the compiler reads that has no entry is a
// defect the generator throws for, so a word cannot land undescribed.

/** A word of the language's, an example of it, and what it means. */
export interface Entry {
  readonly word: string;
  readonly example: string;
  readonly means: string;
}

/** The entry for each of `words`, in their order; throws for a word with none. */
export function entriesFor<E extends { readonly word: string | null }>(
  what: string,
  words: readonly string[],
  entries: readonly E[],
): E[] {
  return words.map((word) => {
    const entry = entries.find((one) => one.word === word);
    if (entry === undefined) throw new Error(`The ${what} \`${word}\` has no entry in the skill.`);
    return entry;
  });
}

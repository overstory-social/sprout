// The statement goldens' extensions cases. Spec support: the package build leaves it out.

import type { Case } from '../exec-cases.js';

export const EXTENSIONS: readonly Case[] = [
  // Extensions.
  {
    name: 'an extension’s statement records an effect for the people in the place',
    area: 'extension',
    body: 'media.show("purr.png", "a purr")',
    records: 'as-told',
  },
  {
    name: 'recording past the host’s cap faults',
    area: 'extension',
    body: 'media.show("purr.png", "a purr")',
    budgets: { extensionEffects: 0 },
    records: 'as-told',
  },
  {
    name: 'an extension the host does not install records nothing',
    area: 'extension',
    body: 'slides.show("purr.png")',
    records: 'as-told',
  },
];

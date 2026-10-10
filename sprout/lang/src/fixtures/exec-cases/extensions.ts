// The statement goldens' extensions cases. Spec support: the package build leaves it out.

import type { Case } from '../exec-cases.js';

export const EXTENSIONS: readonly Case[] = [
  // Extensions.
  {
    name: 'an extension’s statement records an effect for the people in the place',
    area: 'extension',
    body: 'media.play("purr.ogg")',
    records: 'as-told',
  },
  {
    name: 'recording past the host’s cap faults',
    area: 'extension',
    body: 'media.play("purr.ogg")',
    budgets: { extensionEffects: 0 },
    records: 'as-told',
  },
];

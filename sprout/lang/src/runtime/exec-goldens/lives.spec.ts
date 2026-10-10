// The statement goldens for spawning, destroying and links: each case ends as the committed golden says.

import { areaGolden } from '../../fixtures/exec-golden.js';

areaGolden('spawning, destroying and links', ['spawn', 'destroy', 'connect']);

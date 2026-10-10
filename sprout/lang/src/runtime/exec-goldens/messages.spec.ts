// The statement goldens for sends, broadcasts and the bus: each case ends as the committed golden says.

import { areaGolden } from '../../fixtures/exec-golden.js';

areaGolden('sends, broadcasts and the bus', ['send', 'bus']);

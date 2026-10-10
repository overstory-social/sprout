// The statement goldens for writes to `self` and conditions: each case ends as the committed golden says.

import { areaGolden } from '../../fixtures/exec-golden.js';

areaGolden('writes to `self` and conditions', ['write', 'if']);

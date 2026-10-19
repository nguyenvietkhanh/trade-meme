// Isolated test process only: exercise owner-only paper HTTP routes without a real key.
import './scalp-feed.js';
import {OwnerAuth} from '../../src/security.js';
OwnerAuth.prototype.authenticated=()=>true;

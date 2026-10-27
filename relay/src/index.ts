// The Worker entry. Workers treat every export here as an entrypoint, so the
// relay's helpers live in relay.ts.
import { createRelay } from './relay.ts';

export default createRelay();

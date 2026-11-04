import { settings } from './settings.js';

/*
  Geometry detail by tier. Phones draw the same mela with fewer segments on small round things
  (bulbs, marigolds, diyas, laddoos) where nobody can count the facets. Call these while building,
  not at module load: the tier is only known once main.js has run settings.detect().
*/

/** True when building for the phone tier. */
export const lowDetail = () => settings.tier === 'low';

/** A segment count: `high` on the high tier, `low` on phones. */
export const seg = (high, low) => (lowDetail() ? low : high);

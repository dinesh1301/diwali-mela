// Prints the personal-slot catalog (src/personalSlots.js) as JSON, for the launch service / the
// model that writes a creator's `mela` map.
//
//   node tools/export-slots.mjs > slots.json
import { SLOTS, THEMES } from '../src/personalSlots.js';

const out = {
  version: 1,
  config: 'CreatorConfig.mela = { [slotId]: string } (see src/creatorStage.js)',
  rules: [
    'Unknown ids, non-strings and empty strings are ignored; the default stays.',
    'Text is cleaned (no HTML, control or bidi characters; < > ` \\ and braces removed) and whitespace collapsed.',
    '{first} and {name} are replaced with the creator’s first / full name; game strings may also use {prize}.',
    'Longer than maxLen (in characters): cut at a word boundary when within 1.5x maxLen, otherwise the default is kept.',
    `stallTheme values must be one of: ${THEMES.join(', ')} ('general' keeps the stall’s own goods).`,
    'creatorDefault (when present) is used on a creator’s mela if the slot is not set.',
  ],
  themes: THEMES,
  slots: SLOTS,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');

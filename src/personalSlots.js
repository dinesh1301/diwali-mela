/*
  Personal slots: every bit of text (and the stall themes) a creator's mela can rename, so that a
  follower opening mela.topmate.io/<creator> finds the whole fair dressed for that creator, not
  just their own stall.

  The catalog (SLOTS) is plain data, importable from node (tools/export-slots.mjs prints it as
  JSON for the launch service / the LLM that writes a creator's map). A creator config carries
  `mela: { [slotId]: string }`; setMelaSlots() validates it once, before the world is built, and
  every builder reads its text through slot(id), so signs are painted with the creator's words
  the first time (no repaint, nothing un-merged, no per-frame cost).

  Rules for a value:
    - unknown ids, non-strings and empty strings are ignored (the default stays)
    - text is cleaned: control / bidi characters, < > ` \ and stray braces removed, whitespace collapsed
    - {first} and {name} are filled with the creator's first / full name; game strings may use {prize}
    - longer than maxLen: cut at a word boundary if it is within 1.5x maxLen, else the default stays
    - stallTheme values must be one of THEMES ('general' keeps the stall's own goods)
  A few slots have a `creatorDefault`: used when a creator is present but did not set that slot.

  Kinds: stallTitle · stallTheme · sign · prize · toast · shout · menu
*/

/** Stall themes (src/stallThemes.js builds them). */
export const THEMES = ['books', 'tech', 'fitness', 'food', 'finance', 'fashion', 'art', 'music', 'travel', 'career', 'general'];

const S = (id, kind, def, maxLen, where, context, extra = {}) => ({ id, kind, default: def, maxLen, where, context, ...extra });

// the bazaar: stall No. 1 is nearest the gate; odd numbers on the left walking in, even on the right
const STALLS = [
  { goods: 'mithai', no: 1, side: 'left', title: 'Mithai Mahal', sub: 'Laddoo · Barfi · Kaju Katli', what: 'a sweet shop: the visitor picks a mithai from a menu and eats it' },
  { goods: 'diyas', no: 2, side: 'right', title: 'Diya Bazaar', sub: 'Hand-made clay diyas', what: 'sells a clay diya the visitor can place on the Deepmala wall or float on the river', shop: true },
  { goods: 'jalebi', no: 3, side: 'left', title: 'Jalebi Junction', sub: 'Garam garam, fresh!', what: 'hot jalebi: the visitor eats one and gets a sugar rush (runs faster)' },
  { goods: 'lanterns', no: 4, side: 'right', title: 'Kandeel House', sub: 'Lanterns for every home', what: 'sells a paper kandeel (lantern) in a colour picked from a menu', shop: true },
  { goods: 'panipuri', no: 5, side: 'left', title: 'Pani Puri Point', sub: 'Teekha · Meetha · Jaljeera', what: 'pani puri and the Golgappa Challenge (eat as many as you can before it gets too spicy)' },
  { goods: 'bangles', no: 6, side: 'right', title: 'Choodi Gali', sub: 'Bangles & bindis', what: 'the visitor tries on glass bangles in a colour picked from a menu', shop: true },
  { goods: 'kulfi', no: 7, side: 'left', title: 'Kulfi Corner', sub: 'Malai · Kesar · Pista', what: 'kulfi ice cream: the visitor picks a flavour from a menu' },
  { goods: 'toys', no: 8, side: 'right', title: 'Gubbare & Khilone', sub: 'Balloons and toys', what: 'sells a balloon on a string in a colour picked from a menu', shop: true },
];

const MENUS = {
  mithai: ['Motichoor laddoo', 'Kaju katli', 'Gulab jamun', 'Pista barfi'],
  jalebi: ['Eat hot jalebi'],
  panipuri: ['Teekha challenge', 'Meetha challenge', 'Just one, please'],
  kulfi: ['Malai', 'Kesar', 'Pista', 'Mango'],
  lanterns: ['Rani pink', 'Marigold', 'Jamuni purple', 'Peacock blue'],
  bangles: ['Lal (red)', 'Hara (green)', 'Sona (gold)', 'Jamuni (purple)'],
  toys: ['Pink', 'Yellow', 'Blue', 'Green'],
};
const MENU_WHAT = {
  mithai: 'a sweet on the Mithai Mahal menu (a pink / gold / green sweet is served whatever it is called)',
  jalebi: 'the button label to eat a jalebi at Jalebi Junction (an emoji is added)',
  panipuri: 'an option on the Golgappa menu: 1 = the spicy challenge, 2 = the sweet challenge, 3 = a single golgappa',
  kulfi: 'a kulfi flavour (1 cream, 2 saffron-orange, 3 pistachio-green, 4 mango-yellow coloured)',
  lanterns: 'a kandeel (lantern) colour: 1 pink, 2 marigold orange, 3 purple, 4 peacock blue',
  bangles: 'a bangle colour: 1 red, 2 green, 3 gold, 4 purple',
  toys: 'a balloon colour: 1 pink, 2 yellow, 3 blue, 4 green',
};

const BOOTHS = [
  { id: 'shoot', title: 'Gubbara Phod', sub: 'Balloon shooting · win {prize}', prize: 'a teddy bear', where: 'Khel Gali (games lane, east of the bazaar), booth 1 nearest the chowk', what: 'balloon shooting: pop 6 of 10 balloons' },
  { id: 'rings', title: 'Ring Toss', sub: 'Ring 2 bottles · win {prize}', prize: 'a gift box', where: 'Khel Gali, booth 2', what: 'ring toss: land rings on bottles' },
  { id: 'cans', title: 'Dabba Maar', sub: 'Knock down all 6 cans', prize: 'a teddy bear', where: 'Khel Gali, booth 3', what: 'throw balls to knock down a pyramid of 6 cans' },
  { id: 'striker', title: 'Taakat Pariksha', sub: 'Strongman · ring the bell', prize: 'a gift box', where: 'Khel Gali, booth 4 nearest the gate (open-top strongman tower)', what: 'strongman: swing the hammer in the green zone to ring the bell' },
];

const ZONE_TEXT = [
  ['gate', '🪔 Welcome to the Topmate Diwali Mela!', 'walking in under the entrance gate', { creatorDefault: '🪔 Welcome to {first}’s Diwali Mela!' }],
  ['selfie', '📸 Selfie Point: get your mela poster to share', 'the Selfie Point east of the gate'],
  ['deepmala', '🪔 The Deepmala wall', 'the Deepmala wall west of the gate (followed by “: bring a diya or kandeel and press Q to add yours”)'],
  ['ramleela', '📽️ Ramleela Maidan: take a seat for the Ramayan show', 'the open-air Ramayan screen west of the gate'],
  ['ravan', '🔥 Ravan Dahan: the effigy burns on the countdown, or light the fuse yourself', 'the Ravan effigy (the creator’s banner stands in its crowd)'],
  ['bazaar', '🛍️ The Bazaar', 'walking into the bazaar of 8 stalls (followed by “: walk up to a stall and press E”)'],
  ['games', '🎯 Khel Gali: four mela games, win prizes!', 'the games lane with 4 game booths'],
  ['carousel', '🎠 The Carousel: hop on!', 'the carousel west of the bazaar'],
  ['cars', '🏁 Chakri Cars', 'the go-kart circuit (followed by “: a go-kart circuit · press E at a car”)'],
  ['airfield', '✈️ Pushpak Viman Airfield: fly the plane or the heli', 'the airfield where visitors fly a plane or helicopter'],
  ['wheel', '🎡 The Giant Wheel', 'the giant ferris wheel (followed by “: walk to the steps and press E”)'],
  ['fireworks', '🚀 Fireworks Zone', 'the fireworks field (followed by “: press 1 to launch a rocket”)'],
  ['ghat', '🏮 The Ghat: float a diya, release a lantern, or row a boat out from the jetty', 'the river ghat steps at the far end of the mela'],
];

const SIGN = 'Painted signboard; shrinks to fit, short reads best on a phone.';

export const SLOTS = [
  // ---- the gate ----
  S('gate.title', 'sign', 'शुभ दीपावली', 20, 'entrance gate arch, big top line (front, facing arriving visitors)', 'The greeting painted across the main entrance arch. Big decorative lettering.'),
  S('gate.subtitle', 'sign', 'TOPMATE DIWALI MELA', 34, 'entrance gate arch, the line under the greeting (painted between ✦ stars)', 'Whose mela this is.', { creatorDefault: '{name}’s Diwali Mela' }),
  S('gate.back', 'sign', 'Happy Diwali from Topmate · See you again', 44, 'back of the entrance arch, seen when leaving', 'A goodbye line under “फिर मिलेंगे!”.'),

  // ---- the bazaar stalls ----
  ...STALLS.flatMap((st) => [
    S(`stall.${st.goods}.title`, 'stallTitle', st.title, 22, `bazaar stall No. ${st.no} signboard (${st.side} side walking in from the gate)`, `Name of the stall; ${st.what}. Also the title of its menu. Ignored on the creator’s own stall (stallNo), which shows their portrait board.`),
    S(`stall.${st.goods}.sub`, 'sign', st.sub, 32, `bazaar stall No. ${st.no} signboard, small line under the name`, `What the stall offers; ${st.what}.`),
    ...(st.shop
      ? [S(`stall.${st.goods}.theme`, 'stallTheme', 'general', 10, `bazaar stall No. ${st.no}: the goods on its counter and shelves`, `Restocks the counter for a niche (one of ${THEMES.join(', ')}); 'general' keeps its own goods. The stall still sells its usual item when visited (${st.what}), so pick a theme that sits well beside it.`, { options: THEMES })]
      : []),
  ]),

  // ---- menus ----
  ...Object.entries(MENUS).flatMap(([goods, items]) =>
    items.map((d, i) => {
      const st = STALLS.find((s) => s.goods === goods);
      return S(`menu.${goods}.${i + 1}`, 'menu', d, 24, `${st.title} (bazaar stall No. ${st.no}) menu, option ${i + 1}`, `Name of ${MENU_WHAT[goods]}.`);
    })
  ),

  // ---- Khel Gali game booths ----
  ...BOOTHS.flatMap((b) => [
    S(`game.${b.id}.title`, 'sign', b.title, 20, `${b.where}: the booth signboard and the game’s on-screen title`, `${b.what}. ${SIGN}`),
    S(`game.${b.id}.sub`, 'sign', b.sub, 34, `${b.where}: small line under the booth name`, `What to do / what you win. {prize} is replaced by the prize name.`),
    S(`game.${b.id}.prize`, 'prize', b.prize, 26, `${b.where}: the win message (“You won …”) and the toast when you carry it out`, `The prize, with its article (“a …”), e.g. “a Kaggle hoodie”. You hold a ${b.prize.replace(/^an? /, '')} model whatever it is called.`),
  ]),
  S('game.golgappa.title', 'sign', 'Golgappa Challenge', 22, 'Pani Puri Point (bazaar stall No. 5): the on-screen title of the eating challenge', 'Eat golgappas one by one before they go soggy, until it is too spicy.'),
  S('game.golgappa.prize', 'prize', 'the Golgappa Champion title', 34, 'Golgappa Challenge result card, when you eat 10 or more', 'What a champion eater wins, with its article.'),

  // ---- rides and places ----
  S('ride.wheel.sign', 'sign', 'Giant Wheel', 22, 'giant ferris wheel boarding steps signboard', `The big wheel ride. ${SIGN}`),
  S('ride.carousel.sign', 'sign', 'Carousel', 22, 'carousel signboard', `The merry-go-round with horses. ${SIGN}`),
  S('ride.train.station1', 'sign', 'Bazaar Station', 22, 'toy train platform beside the bazaar, signboard', 'Name of a stop on the toy train loop.'),
  S('ride.train.station2', 'sign', 'Khel Gali Station', 22, 'toy train platform behind the game booths, signboard', 'Name of the other toy train stop.'),
  S('ride.boat.sign', 'sign', 'Naav ki Sair', 22, 'boat jetty at the ghat, signboard', 'Row a wooden boat on the river.'),
  S('ride.boat.name', 'sign', 'Ganga Naav', 14, 'name plate on the rowing boat’s bow', 'The boat’s name, painted small.'),
  S('ride.airfield.sign', 'sign', 'Pushpak Viman Airfield', 26, 'airfield hangar signboard (east of the games lane)', 'Fly a plane or a helicopter over the mela.'),
  S('ride.viman.plate', 'sign', 'Pushpak Viman', 16, 'name plate on both sides of the plane', 'The plane’s name.'),
  S('ride.cars.sign', 'sign', 'Chakri Cars', 22, 'go-kart circuit, the big sign over the start line', 'A go-kart race track.'),
  S('ride.cars.plate', 'sign', 'Chakri Racer', 14, 'name plate on the back of every go-kart', 'The go-karts’ name.'),
  S('sign.fireworks', 'sign', 'Fireworks Zone', 22, 'fireworks field signboard', 'Where rockets launch.'),
  S('sign.fireworks.sub', 'sign', 'Rockets launch here · stand back!', 36, 'fireworks field signboard, small line', 'A safety line for the rocket field.'),
  S('sign.ramleela', 'sign', 'Ramleela Maidan', 22, 'Ramayan show screen signboard (west of the gate)', 'The open-air Ramayan screening.'),
  S('sign.ravan', 'sign', 'Ravan Dahan', 22, 'Ravan effigy signboard', 'The effigy that burns on a countdown.'),
  S('sign.selfie', 'sign', 'Selfie Point', 22, 'Selfie Point signboard (east of the gate)', 'Take a mela poster photo to share.'),
  S('selfie.frame1', 'sign', 'Topmate', 16, 'Selfie Point backdrop, big first line (behind you in every selfie)', 'Painted large; a name or a word.', { creatorDefault: '{first}’s' }),
  S('selfie.frame2', 'sign', 'Diwali Mela', 16, 'Selfie Point backdrop, big second line', 'Painted large under the first line.'),
  S('selfie.tagline', 'sign', '#TopmateDiwaliMela', 28, 'Selfie Point backdrop, small line under the title (the year is added)', 'A hashtag or a short line.'),
  S('sign.deepmala', 'sign', 'Deepmala', 22, 'header of the Deepmala wall (west of the gate)', 'A wall of niches where visitors place diyas and kandeels.'),
  S('sign.ghat', 'sign', 'Ganga Ghat', 22, 'signboard at the top of the river ghat steps', 'The riverside steps.'),
  S('sign.ghat.sub', 'sign', 'Float a diya · release a wish lantern', 36, 'ghat signboard, small line', 'What to do at the river.'),

  // ---- zone toasts ----
  ...ZONE_TEXT.map(([id, d, where, extra]) => S(`zone.${id}`, 'toast', d, 72, `toast when you walk into ${where}`, 'One line; start with an emoji. Keep any instruction out of it (the controls hint is added).', extra)),
  S('toast.wheel.on', 'toast', '🎡 Enjoy the view!', 40, 'toast on boarding the giant wheel (“Press E to get off” is added)', 'A cheerful line as the wheel lifts you.'),
  S('toast.wheel.off', 'toast', 'Hope you enjoyed the view! 🎡', 40, 'toast on getting off the giant wheel', 'A goodbye line.'),
  S('toast.carousel.on', 'toast', '🎠 Wheee!', 40, 'toast on boarding the carousel (“Press E to get off” is added)', 'A cheerful line.'),
  S('toast.carousel.off', 'toast', 'That was fun! 🎠', 40, 'toast on getting off the carousel', 'A goodbye line.'),

  // ---- shouts (speech bubbles) ----
  S('shout.keeper.1', 'shout', 'Aaiye, aaiye! 🙏', 40, 'speech bubble over a stall-keeper when you walk up to any stall', 'A stall-keeper calling you over.'),
  S('shout.keeper.2', 'shout', 'Happy Diwali! ✨', 40, 'stall-keeper speech bubble (another variant)', 'A stall-keeper greeting.'),
  S('shout.keeper.3', 'shout', 'Fresh hai, le lo! 😄', 40, 'stall-keeper speech bubble (another variant)', 'A stall-keeper selling.'),
  S('shout.crowd.1', 'shout', 'Have you tried the jalebi? 😋', 44, 'speech bubble of a visitor you greet in the crowd', 'Something a fellow visitor says to you.'),
  S('shout.crowd.2', 'shout', 'The ring toss is tricky! ⭕', 44, 'crowd visitor speech bubble (another variant)', 'Something a fellow visitor says.'),
  S('shout.crowd.3', 'shout', 'Ride the giant wheel, the view is amazing! 🎡', 44, 'crowd visitor speech bubble (another variant)', 'Something a fellow visitor says.'),
  S('shout.golgappa', 'shout', 'Ekdum teekha banaunga! 😈', 40, 'Pani Puri keeper as the spicy Golgappa Challenge starts', 'A playful threat.'),
  S('shout.diyas', 'shout', 'Shubh Deepavali! 🪔', 40, 'Diya Bazaar keeper as he hands you a diya', 'A blessing.'),
  S('shout.lanterns', 'shout', 'Ghar roshan ho jayega! ✨', 40, 'Kandeel House keeper as he hands you a lantern', 'A compliment / blessing.'),
  S('shout.bangles', 'shout', 'Bahut sundar lag rahe hain! ✨', 40, 'Choodi Gali keeper after you try on bangles', 'A compliment.'),
];

export const SLOT_BY_ID = new Map(SLOTS.map((s) => [s.id, s]));

// ---------- runtime ----------

let current = {}; // id -> cleaned value (only the slots a creator set, or creatorDefaults)
let report = { applied: [], rejected: [] };

const len = (t) => [...t].length;

/** Cleans a value for a slot: plain text only, braces only as {prize}, clamped to the slot's length. Returns null if unusable. */
export function cleanText(v, maxLen, vars = {}) {
  if (typeof v !== 'string') return null;
  let t = v.normalize('NFC').replace(/\{(first|name)\}/gi, (_, k) => vars[k.toLowerCase()] ?? '');
  t = t
    .replace(/[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]/g, ' ')
    .replace(/[<>`\\]/g, '')
    .split('{prize}')
    .map((s) => s.replace(/[{}]/g, ''))
    .join('{prize}')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  if (len(t) <= maxLen) return t;
  if (len(t) > Math.ceil(maxLen * 1.5)) return null;
  const chars = [...t];
  const head = chars.slice(0, maxLen + 1).join('');
  const cut = head.lastIndexOf(' ');
  const out = (cut > head.length * 0.5 ? head.slice(0, cut) : chars.slice(0, maxLen).join('')).replace(/[\s,;:·-]+$/, '');
  return out || null;
}

/**
 * Takes a creator's `mela` map (and the creator, for {first}/{name} and the creatorDefaults).
 * Call once, before the world is built. Returns { applied: ids, rejected: [{ id, reason }] }.
 */
export function setMelaSlots(map, creator = null) {
  current = {};
  report = { applied: [], rejected: [] };
  const vars = creator ? { first: creator.first ?? '', name: creator.name ?? '' } : {};
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [id, raw] of Object.entries(map).slice(0, 400)) {
      const s = SLOT_BY_ID.get(id);
      if (!s) {
        report.rejected.push({ id: String(id).slice(0, 60), reason: 'unknown slot' });
        continue;
      }
      if (s.kind === 'stallTheme') {
        if (typeof raw === 'string' && THEMES.includes(raw.trim().toLowerCase())) {
          current[id] = raw.trim().toLowerCase();
          report.applied.push(id);
        } else report.rejected.push({ id, reason: 'not a theme' });
        continue;
      }
      const t = cleanText(raw, s.maxLen, vars);
      if (t == null) report.rejected.push({ id, reason: typeof raw === 'string' && raw.trim() ? 'too long' : 'empty or not text' });
      else {
        current[id] = t;
        report.applied.push(id);
      }
    }
  }
  if (creator) {
    for (const s of SLOTS) {
      if (s.creatorDefault && !(s.id in current)) {
        const t = cleanText(s.creatorDefault, s.maxLen, vars);
        if (t) current[s.id] = t;
      }
    }
  }
  return report;
}

/** The text for a slot: the creator's, or the default. `vars` fills {prize}-style placeholders. */
export function slot(id, vars) {
  const s = SLOT_BY_ID.get(id);
  let v = current[id] ?? s?.default ?? '';
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return v;
}

/** True when the creator (or a creatorDefault) set this slot. */
export const slotSet = (id) => id in current;

/** What the last setMelaSlots() applied and rejected (for checks and the console). */
export const melaReport = () => ({ ...report, values: { ...current } });

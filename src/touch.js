/*
  Phones and tablets: one flag for "this is a touch screen", decided once at load (body.touch in
  style.css follows it), and a tiny helper so every bit of copy that names a key has a tap version
  next to it instead of an `if` at each call site:  tk('Press E to get off', 'Tap “Get off”').
  ?touch forces the touch UI on a desktop browser (for testing).
*/
export const TOUCH =
  typeof matchMedia === 'function' && (matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch'));

const DIRECTOR = typeof location !== 'undefined' && new URLSearchParams(location.search).has('director');

/** keyText on a keyboard, tapText on a touch screen; in a trailer capture (?director) the control-free
 *  `filmText` when given, so no in-world sign films a keyboard hint. */
export const tk = (keyText, tapText, filmText) => (DIRECTOR && filmText ? filmText : TOUCH ? tapText : keyText);

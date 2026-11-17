// Emotion scores → face intents, ported from canine-expression-lab (L4; docs/expressions/lab-emotion-system.md §2-3).
// A dialogue model scores each sentence on these dimensions (bipolar ones −1..1, the rest 0..1); this turns them into
// the shared intents, which face.js maps onto 小鲸's channels. Coefficients are the lab's (designed, not fitted),
// plus three intents of our own that this drawing style needs: flush (blush), wet (watery eyes), shrink (pupils).
// Score her "compared with how she usually is": she is warm and clingy by nature (lab judge.relativeDimensions).

export const DIMENSIONS = {
  // dim: [coefficients when positive, coefficients when negative (bipolar only)]
  valence: [{smile: 0.6, soft: 0.1, alert: 0.1}, {smile: -0.35, lower: 0.3, plead: 0.3, soft: 0.1}],
  arousal: [{alert: 0.55, open: 0.25, lower: -0.1}],
  care: [{plead: 0.55, tension: 0.25, lower: 0.15, engage: 0.3}],
  confidence: [{lower: -0.15, alert: 0.1, engage: 0.2}, {lower: 0.3, avert: 0.35, plead: 0.2, soft: 0.1, engage: -0.4}],
  playful: [{tilt: 0.35, smile: 0.3, alert: 0.25, avert: 0.15}],
  uncertainty: [{tilt: 0.9, avert: 0.3, plead: 0.25, smile: -0.05, engage: -0.25}],
  warmth: [{soft: 0.3, smile: 0.3, engage: 0.3, tilt: 0.1, flush: 0.3}],
  attention: [{engage: 0.45, alert: 0.15}],
  annoyance: [{tension: 0.6, alert: 0.25, smile: -0.3, lower: -0.05, flush: 0.2}],
  fear: [{alert: 0.55, tension: 0.35, plead: 0.3, lower: -0.12, open: 0.15, smile: -0.15, wet: 0.3, shrink: 0.8}],
  surprise: [{alert: 0.7, open: 0.45, lower: -0.15, shrink: 0.3}],
  disgust: [{tension: 0.3, smile: -0.35, avert: 0.5, lower: -0.1, soft: 0.1}],
  fatigue: [{soft: 0.75, lower: 0.3}],
  anticipation: [{alert: 0.35, engage: 0.3, lower: -0.08, tilt: 0.05}],
  trust: [{soft: 0.25, smile: 0.15, engage: 0.3, tension: -0.2}],
};
const BIPOLAR = new Set(['valence', 'confidence']);
const RANGE = {lower: [-1, 1], avert: [-1, 1], smile: [-1, 1], tilt: [-1, 1]};
export const INTENTS = ['alert', 'lower', 'engage', 'avert', 'plead', 'smile', 'open', 'tension', 'tilt', 'soft',
  'flush', 'wet', 'shrink'];

// dims: {valence: -1..1, arousal: 0..1, …}; sig: optional signature scores 0..1 {shy, aggrieved};
// intensity 0..1 scales everything but engage (lab: 0.6 + 0.8 × intensity)
export function intentsFromDims(dims, {intensity = 0.5, sig = {}} = {}) {
  const I = Object.fromEntries(INTENTS.map(k => [k, 0]));
  I.engage = 0.55;
  const scale = 0.6 + 0.8 * intensity;
  for (const [dim, [pos, neg]] of Object.entries(DIMENSIONS)) {
    const v = dims[dim] ?? 0;
    if (!v) continue;
    const coef = v >= 0 || !BIPOLAR.has(dim) ? pos : neg;
    for (const [k, c] of Object.entries(coef)) I[k] += c * Math.abs(v) * (k === 'engage' ? 1 : scale);
  }
  // ours: flush and wet also come from valence, and from the shy / aggrieved signatures
  const val = dims.valence ?? 0;
  I.flush += 0.15 * Math.max(0, val) + 0.1 * (dims.arousal ?? 0) + 0.9 * (sig.shy ?? 0);
  I.wet += 0.5 * Math.max(0, -val) + 0.2 * (dims.care ?? 0) + 0.6 * (sig.aggrieved ?? 0)
         + (val > 0 && (dims.warmth ?? 0) > 0.7 ? 0.25 : 0);     // touched
  if (sig.aggrieved) { I.plead += 0.6 * sig.aggrieved; I.smile -= 0.4 * sig.aggrieved; }
  if (sig.shy) { I.lower += 0.3 * sig.shy; I.avert += 0.3 * sig.shy; I.smile += 0.2 * sig.shy; }
  // lab conflict rules, in order
  if (I.smile > 0.3) I.tension *= 0.5;                       // otherwise it reads as baring teeth
  if ((dims.care ?? 0) > 0.5) I.avert *= 0.4;
  if ((dims.attention ?? 0) > 0.6) I.avert *= 0.5;
  if (I.alert > 0.5) I.soft *= 0.5;
  if ((dims.annoyance ?? 0) > 0.4) I.smile *= 0.3;           // otherwise a sneer
  if ((dims.fear ?? 0) > 0.4) I.smile *= 0.3;                // otherwise a forced smile
  for (const k of INTENTS) {
    const [lo, hi] = RANGE[k] ?? [0, 1];
    I[k] = Math.min(Math.max(I[k], lo), hi);
  }
  return I;
}

// lab tempo: speed = (0.7 + 0.6 × tempo) × (1 + 0.3 × arousal)
export function speed(tempo = 0.5, arousal = 0) { return (0.7 + 0.6 * tempo) * (1 + 0.3 * arousal); }

// L7 triggers (parameter-proposal.md §5): which special a set of scores calls for, if any
export function pickSpecial(dims) {
  const g = k => dims[k] ?? 0;
  if (g('fear') >= 0.6 && g('arousal') >= 0.7) return 'squeeze';
  if ((g('surprise') >= 0.75 && g('valence') <= 0) || (g('surprise') >= 0.7 && g('disgust') >= 0.4)) return 'shocked';
  if ((g('valence') >= 0.8 && g('surprise') >= 0.6) || (g('valence') >= 0.95 && g('arousal') >= 0.8)) return 'starstruck';
  if (g('valence') >= 0.8 && g('warmth') >= 0.6) return 'lovestruck';
  if (g('valence') <= -0.85) return 'crying';
  if (g('fatigue') >= 0.9) return 'asleep';
  return null;
}

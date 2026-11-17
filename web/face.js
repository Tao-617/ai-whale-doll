// Parametric face: eyes, brows, mouth and cheeks are drawn in shaders on small sheets laid on the face
// (EyeL / EyeR / BrowL / BrowR / Mouth / CheekL / CheekR, built by scripts/blender/v2/23-face.py), so every expression
// is a set of channel values that blend continuously and stay sharp.
//
// Layers, after canine-expression-lab (docs/expressions/lab-emotion-system.md) and the 小鲸 videos
// (docs/expressions/video-catalogue.md, parameter-proposal.md):
//   intents (alert, smile, plead, …; emotion.js turns emotion scores into these)  →  channels (CHANNEL_INTENTS)
//   or an expression preset (EXPRESSIONS: channel targets measured against docs/expressions/frames)
//   → grouped second-order transitions (GROUPS: eyes fast, mouth after the head, blush in fast / out slow)
//   → specials (SPECIALS: whole-eye shapes > < ○ ★ ♥ cut in hard as in the videos, then an afterglow expression)
//   → blink and speech on top.
// Head, ear, tail and ahoge channels are read by app.js.
import * as THREE from 'three';

const SKIN = new THREE.Color().setRGB(244 / 255, 229 / 255, 222 / 255, THREE.SRGBColorSpace);

// eye space: p in [-0.5, 0.5]², x grows toward the outer corner, y up. Proportions measured on the front reference
// (art/turnaround-ref-anime.jpg, her right eye at about x 325-440, y 512-610): a big, nearly round eye mostly filled
// by the iris, a heavy upper lash with two spikes that runs into a red-brown liner down the outer corner.
const EYE = /* glsl */ `
  // fit to the reference (front view, measured 2026-11-11): eye 0.081 m wide × 0.075 m tall, centre at z 0.618,
  // iris 0.051 × 0.054 m. The shapes below are drawn on a 0.86-wide eye, so scale the sheet coordinates.
  p = vec2(p.x * 1.32, (p.y + 0.055) * 1.08);
  float aa = fwidth(p.x) * 1.2;
  float big = max(uOpen - 1.0, 0.0);                               // open > 1: eyes wide (surprise)
  // smiling / content eyes close the lids first; the ^^ or ︶ line takes over only once they are nearly shut
  float s = smoothstep(0.55, 0.95, abs(uSmile));
  float o = clamp(uOpen, 0.0, 1.0) * (1.0 - smoothstep(0.0, 0.75, abs(uSmile)));
  // upper lash centre line and thickness: peaks a little inside the middle, drops steeply into a tail at the outer corner
  float d = p.x + 0.05;
  float lashMid = 0.30 - 0.62 * d * d - 2.2 * pow(max(abs(d) - 0.26, 0.0), 2.0) + big * 0.30;
  float th = mix(0.07, 0.14, smoothstep(-0.42, -0.12, p.x)) * mix(1.0, 0.25, smoothstep(0.36, 0.48, p.x));
  float ux = clamp((p.x + 0.03) / 0.44, -1.0, 1.0);
  float arcB = sqrt(max(1.0 - ux * ux, 0.0));
  float yb = 0.0 - (0.40 + big * 0.25) * arcB;                      // bottom of the opening: just clips the iris
  yb = mix(yb, -0.12 - 0.12 * arcB, uLower);                        // lower lid pushed up (smiling / smug eyes)
  float yc = -0.10 - 0.10 * arcB;                                  // lids meet here when closed
  float yt = lashMid - th * 0.5;                                   // top of the opening = underside of the lash
  // upper lid shapes: flat (half-lidded: grumpy, smug) and slanted (+: inner end down, angry; −: outer end down, pleading)
  yt = mix(yt, min(yt, 0.03 + 0.02 * arcB), uFlat);
  yt -= 0.32 * (uSlant > 0.0 ? uSlant * (0.42 - p.x) : -uSlant * (p.x + 0.42)) * arcB;
  yt = max(yt, yc + 0.02);
  float top = mix(yc, yt, o), bot = mix(yc, yb, o);
  float lash0 = top + th * 0.5;                                    // the lash rides on the upper lid
  float inX = smoothstep(-0.44, -0.42, p.x) * (1.0 - smoothstep(0.40, 0.42, p.x));
  float opening = inX * smoothstep(bot - aa, bot + aa, p.y) * (1.0 - smoothstep(top - aa, top + aa, p.y));

  // white; mauve shadow under the lash and over the outer part; red-brown liner down the outer edge
  vec3 col = srgb(vec3(1.0, 0.98, 0.98));
  // outside the iris the reference shows almost no white: grey-mauve shade, then the red-brown liner
  float mauve = max(smoothstep(top - 0.14, top, p.y), smoothstep(-0.02, 0.14, p.x) * smoothstep(-0.38, -0.12, p.y)) * (1.0 - 0.7 * big);
  col = mix(col, srgb(vec3(0.72, 0.68, 0.79)), mauve);
  col = mix(col, srgb(vec3(0.48, 0.22, 0.18)), smoothstep(0.22, 0.32, p.x) * smoothstep(-0.30, -0.06, p.y) * (1.0 - big));

  // iris, as in the reference (art/turnaround-ref-anime.jpg, eyes enlarged side by side 2026-11-12): flat cel bands —
  // royal blue above, darker under the lash; below, a mid-blue band, then a sky-blue band, then a small soft pale glow,
  // each an ellipse dropped toward the bottom; a tall dark pupil; a dark rim. uPupil scales it.
  vec2 ic = vec2(-0.11 + gz.x * 0.08, -0.045 + gz.y * 0.06);
  vec2 q = (p - ic) / (vec2(0.315, 0.30) * uPupil);
  float r = length(q);
  bool heart = abs(uShape - 4.0) < 0.5;
  float ba = aa * 3.0 / 0.3;                      // band edge width in q units: crisp, but not aliased
  vec3 iris = mix(srgb(vec3(0.13, 0.24, 0.66)), srgb(vec3(0.05, 0.09, 0.33)), smoothstep(0.1, 0.65, q.y));
  iris = mix(iris, srgb(vec3(0.17, 0.43, 0.86)), 1.0 - smoothstep(1.0 - ba, 1.0 + ba, length((q - vec2(0.0, -0.42)) / vec2(0.96, 0.74))));
  iris = mix(iris, srgb(vec3(0.33, 0.64, 0.96)), 1.0 - smoothstep(1.0 - ba, 1.0 + ba, length((q - vec2(0.0, -0.62)) / vec2(0.74, 0.50))));
  iris = mix(iris, srgb(vec3(0.78, 0.88, 0.92)), 0.92 * (1.0 - smoothstep(0.65, 1.0, length((q - vec2(0.0, -0.70)) / vec2(0.52, 0.38)))));
  // pupil: a tall drop, narrower at the top
  vec2 pq = q - vec2(0.0, -0.04);
  float pupil = 1.0 - smoothstep(0.86, 1.0, length(pq / vec2(0.27 * (1.0 - 0.3 * clamp(pq.y / 0.40, -1.0, 1.0)), 0.40)));
  iris = mix(iris, srgb(vec3(0.03, 0.06, 0.24)), pupil * 0.92);
  iris = mix(iris, srgb(vec3(0.04, 0.06, 0.22)), smoothstep(0.90, 0.97, r));
  // ♥ eyes: a pink heart fills the iris
  vec2 hq = q * vec2(1.15, 1.15) + vec2(0.0, 0.15);
  float hx = abs(hq.x), hv = hq.y;
  float hb = hx * hx + hv * hv - 0.55;
  float hd = hb * hb * hb - hx * hx * hv * hv * hv;   // (x² + y² − r)³ − x²y³ < 0 inside
  float heartIn = (1.0 - smoothstep(-0.004, 0.004, hd)) * step(r, 1.3);
  float irisIn = 1.0 - smoothstep(1.0 - aa * 4.0, 1.0, r);
  float hs = heart ? uShapeAmt : 0.0;
  col = mix(col, iris, irisIn * (1.0 - hs));
  col = mix(col, srgb(vec3(0.96, 0.36, 0.55)), heartIn * hs);
  // highlights; ★ eyes swap the big round one for a four-pointed star
  float star = abs(uShape - 3.0) < 0.5 ? uShapeAmt : 0.0;
  // a round highlight high in the iris just to the nose side of the pupil (clear of the lash), a small one beyond it
  // toward the nose, a dot over the pupil
  // (eye space is stretched 1.32 × 1.08 against the sheet, so a round highlight is drawn 1.22× wider)
  float hl = 1.0 - smoothstep(0.055 - aa, 0.055 + aa, length((p - ic - vec2(-0.01, 0.165)) / vec2(1.22, 1.0)));
  hl = max(hl, 1.0 - smoothstep(0.02 - aa, 0.02 + aa, length((p - ic - vec2(-0.125, 0.17)) / vec2(1.4, 0.75))));
  hl *= 1.0 - star;
  hl = max(hl, 1.0 - smoothstep(0.011 - aa, 0.011 + aa, length(p - ic - vec2(0.0, 0.085))));
  hl = max(hl, 1.0 - smoothstep(0.013 - aa, 0.013 + aa, length(p - ic - vec2(0.262, -0.085))));
  hl = max(hl, 1.0 - smoothstep(0.013 - aa, 0.013 + aa, length(p - ic - vec2(-0.262, -0.085))));
  vec2 sq = abs(p - ic - vec2(-0.02, 0.06)) / 0.21;
  float sd = sqrt(sq.x) + sqrt(sq.y);
  hl = max(hl, star * (1.0 - smoothstep(0.92, 1.0, sd)));
  // watery eyes: small extra glints and a pale water line along the lower lid
  float wet = clamp(uShine, 0.0, 1.0);
  for (int i = 0; i < 3; i++) {
    vec2 g = ic + vec2(-0.16 + 0.15 * float(i), -0.17 + 0.04 * float(i % 2));
    hl = max(hl, wet * (1.0 - smoothstep(0.018 - aa, 0.018 + aa, length(p - g))));
  }
  col = mix(col, vec3(1.0), hl * step(r, 1.0));
  col = mix(col, srgb(vec3(0.75, 0.88, 1.0)), wet * 0.8 * (1.0 - smoothstep(0.0, 0.06, p.y - bot)) * inX);

  // upper lash: heavy band with two spikes on top, tail past the outer corner
  float lx = smoothstep(-0.44, -0.40, p.x) * (1.0 - smoothstep(0.47, 0.49, p.x));
  float lash = lx * (1.0 - smoothstep(th * 0.5 - aa, th * 0.5 + aa, abs(p.y - lash0)));
  float h1 = p.y - (lash0 + th * 0.5);
  float sp1 = step(0.0, h1) * (1.0 - smoothstep(0.0, aa * 2.0, abs(p.x - 0.08 - h1 * 0.9) - 0.022 * (1.0 - h1 / 0.07))) * step(h1, 0.07);
  float sp2 = step(0.0, h1) * (1.0 - smoothstep(0.0, aa * 2.0, abs(p.x - 0.28 - h1 * 1.2) - 0.022 * (1.0 - h1 / 0.06))) * step(h1, 0.06);
  lash = max(lash, max(sp1, sp2) * smoothstep(0.6, 0.9, o) * (1.0 - uFlat));
  vec3 lashCol = mix(srgb(vec3(0.05, 0.05, 0.11)), srgb(vec3(0.42, 0.19, 0.16)), smoothstep(0.30, 0.44, p.x) * 0.85);
  lashCol = mix(lashCol, srgb(vec3(0.40, 0.21, 0.19)), smoothstep(-0.30, -0.43, p.x));
  // fold line above the lash and a soft pink rim under the eye
  float crease = smoothstep(-0.28, -0.18, p.x) * (1.0 - smoothstep(0.18, 0.26, p.x))
               * (1.0 - smoothstep(0.004, 0.004 + aa * 2.0, abs(p.y - lashMid - 0.12))) * o;
  float rim = smoothstep(-0.32, -0.2, p.x) * (1.0 - smoothstep(0.15, 0.28, p.x))
            * (1.0 - smoothstep(0.006, 0.006 + aa * 2.0, abs(p.y - yb + 0.02))) * o * (1.0 - uLower);

  // closed eyes: + a thick arch ^^ (laughing), − a sagging curve ︶ with a lash flick at the outer end (content, asleep)
  float ad = (p.x + 0.03) / 0.42;
  float arch = -0.06 + 0.24 * (1.0 - ad * ad);
  float sag = -0.02 - 0.16 * (1.0 - ad * ad);
  float taper = 1.0 - smoothstep(0.92, 1.0, abs(ad));
  float happy = taper * (1.0 - smoothstep(0.035 - aa, 0.035 + aa, abs(p.y - arch)));
  float calm = taper * (1.0 - smoothstep(0.042 - aa, 0.042 + aa, abs(p.y - sag)));
  float flick = step(0.28, p.x) * step(p.x, 0.48) * (1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(p.y - (sag + 0.04 + (p.x - 0.28) * 1.1))));
  calm = max(calm, flick);
  float closedLine = uSmile > 0.0 ? happy : calm;

  vec4 eye = vec4(SKIN, 0.0);
  eye = mix(eye, vec4(srgb(vec3(0.62, 0.42, 0.38)), 1.0), crease * 0.45 * (1.0 - s));
  eye = mix(eye, vec4(srgb(vec3(0.93, 0.68, 0.66)), 1.0), rim * 0.6 * (1.0 - s));
  eye = mix(eye, vec4(col, 1.0), opening * (1.0 - s));
  eye = mix(eye, vec4(lashCol, 1.0), lash * (1.0 - s));
  eye = mix(eye, vec4(lashCol, 1.0), closedLine * s);
  // a tear gathering on the lower lid
  float tear = smoothstep(0.55, 0.9, uShine) * (1.0 - s);
  vec2 tp = (p - vec2(0.02, bot - 0.035)) / vec2(0.045, 0.055);
  float tearIn = (1.0 - smoothstep(1.0 - aa * 20.0, 1.0, length(tp))) * tear;
  vec3 tearCol = mix(srgb(vec3(0.70, 0.86, 1.0)), vec3(1.0), 1.0 - smoothstep(0.0, 0.35, length(tp - vec2(-0.3, 0.35))));
  eye = mix(eye, vec4(tearCol, 0.9), tearIn);

  // whole-eye specials: 1 squeeze > <, 2 blank white circle, 5 dizzy spirals
  vec4 sp = vec4(SKIN, 0.0);
  if (abs(uShape - 1.0) < 0.5) {
    // chevron pointing at the nose: apex at the inner side
    vec2 a = vec2(-0.20, -0.06), b1 = vec2(0.30, 0.17), b2 = vec2(0.30, -0.29);
    vec2 pa = p - a;
    float d1 = length(pa - (b1 - a) * clamp(dot(pa, b1 - a) / dot(b1 - a, b1 - a), 0.0, 1.0));
    float d2 = length(pa - (b2 - a) * clamp(dot(pa, b2 - a) / dot(b2 - a, b2 - a), 0.0, 1.0));
    float ch = 1.0 - smoothstep(0.04 - aa, 0.04 + aa, min(d1, d2));
    sp = vec4(srgb(vec3(0.06, 0.06, 0.12)), ch);
  } else if (abs(uShape - 2.0) < 0.5) {
    float rr = length((p - vec2(-0.06, -0.05)) / vec2(0.36, 0.36));
    float fill = 1.0 - smoothstep(1.0 - aa * 3.0, 1.0, rr);
    float ring = (1.0 - smoothstep(0.88, 0.88 + aa * 3.0, rr)) ;
    sp = vec4(mix(srgb(vec3(0.06, 0.06, 0.12)), vec3(1.0), ring), fill);
  } else if (abs(uShape - 5.0) < 0.5) {
    vec2 dq = (p - vec2(-0.06, -0.05)) / vec2(1.10, 1.0);
    float rr = length(dq);
    float fill = 1.0 - smoothstep(0.33 - aa, 0.33 + aa, rr);
    float paper = 1.0 - smoothstep(0.30 - aa, 0.30 + aa, rr);
    // Archimedean spiral: three radial branches, slowly turning even after the mouse stops.
    float angle = mod(atan(dq.y, dq.x) - uTime * 1.8 + 12.56637, 6.283185);
    float dist = 1.0;
    for (int i = 0; i < 3; i++) dist = min(dist, abs(rr - (0.018 + 0.018 * (angle + 6.283185 * float(i)))));
    float ink = (1.0 - smoothstep(0.013 - aa, 0.013 + aa, dist)) * paper;
    ink = max(ink, 1.0 - smoothstep(0.018 - aa, 0.018 + aa, rr));
    vec3 dark = srgb(vec3(0.12, 0.19, 0.39));
    sp = vec4(mix(dark, srgb(vec3(0.97, 0.99, 1.0)), paper * (1.0 - ink)), fill);
  }
  float whole = (abs(uShape - 1.0) < 0.5 || abs(uShape - 2.0) < 0.5 || abs(uShape - 5.0) < 0.5) ? uShapeAmt : 0.0;
  shape = mix(eye, sp, whole);
`;

// mouth space: q in units of the old 0.06 × 0.04 m sheet (the closed mouth sits where it was); the sheet is now
// 0.08 × 0.056 m and 8 mm lower, so wide-open mouths (shouting, laughing, crying) have room below
const MOUTH = /* glsl */ `
  vec2 q = p * vec2(2.0, 1.4) - vec2(0.0, 0.25);      // q.y = 0 at z 0.576, as before
  float aa = fwidth(q.x) * 1.2;
  float shout = clamp(uShout, 0.0, 1.0);
  float hw = mix(0.17, 0.11, uRound) * (1.0 + 0.5 * max(uSmile, 0.0)) * (1.0 + 0.35 * shout);
  float hh = uOpen * mix(0.14, 0.20, uRound) * (1.0 + 0.25 * shout) * (1.0 + 0.6 * uOpen);
  float xn = q.x / hw;
  float y = q.y - uSmile * 0.10 * xn * xn + uSmile * 0.03;      // corners up when smiling
  y += uWave * 0.022 * sin(q.x * 70.0);                         // wobbly mouth (scared, about to cry)
  float isOpen = smoothstep(0.02, 0.06, uOpen);
  // closed shapes: the plain line, ω (cat mouth), 3 (pout), a wave
  float line = (1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(y))) * (1.0 - smoothstep(0.95, 1.0, abs(xn)));
  vec2 c1 = q - vec2(-0.06, 0.05), c2 = q - vec2(0.06, 0.05);
  float om = max((1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(length(c1) - 0.06))) * step(c1.y, 0.005),
                 (1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(length(c2) - 0.06))) * step(c2.y, 0.005));
  vec2 k1 = q - vec2(-0.015, 0.095), k2 = q - vec2(-0.015, 0.005);
  float pk = max((1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(length(k1) - 0.045))) * step(-0.005, k1.x),
                 (1.0 - smoothstep(0.022 - aa, 0.022 + aa, abs(length(k2) - 0.045))) * step(-0.005, k2.x));
  float wv = (1.0 - smoothstep(0.016 - aa, 0.016 + aa, abs(q.y - 0.022 * sin(q.x * 60.0)))) * (1.0 - smoothstep(0.11, 0.13, abs(q.x)));
  float alt = max(max(uCat, uPucker), uWave);
  float closedMouth = max(max(line * (1.0 - alt), om * uCat), max(pk * uPucker, wv * uWave));
  // open: an oval, or a wide trapezoid with the upper teeth showing when shouting
  float e = length(vec2(xn, (y + hh) / max(hh, 1e-3)));
  float inEll = 1.0 - smoothstep(1.0 - aa / hw * 2.0, 1.0, e);
  float rimEll = 1.0 - smoothstep(1.0, 1.0 + aa / hw * 3.0, e);
  float yy = -y / max(hh * 2.0, 1e-3);                            // 0 at the upper lip, 1 at the bottom
  float halfw = hw * mix(1.0, 0.6, clamp(yy, 0.0, 1.0));
  float inTrap = smoothstep(-0.02, 0.02, yy) * (1.0 - smoothstep(0.97, 1.0, yy)) * (1.0 - smoothstep(halfw - aa, halfw + aa, abs(q.x)));
  float rimTrap = smoothstep(-0.12, -0.06, yy) * (1.0 - smoothstep(1.0, 1.08, yy)) * (1.0 - smoothstep(halfw + 0.01, halfw + 0.02, abs(q.x)));
  float inside = mix(inEll, inTrap, shout) * isOpen;
  float rim = mix(rimEll, rimTrap, shout) * isOpen;
  vec3 col = srgb(vec3(0.55, 0.15, 0.18));
  col = mix(col, srgb(vec3(0.95, 0.58, 0.60)), smoothstep(0.55, 0.85, yy));          // tongue
  col = mix(col, vec3(1.0), shout * (1.0 - smoothstep(0.14, 0.18, yy)));             // upper teeth
  // a small fang hanging from the upper lip, on her left
  float ft = clamp(yy / 0.32, 0.0, 1.0);
  float fang = uFang * step(0.0, yy) * step(yy, 0.32) * (1.0 - smoothstep(0.0, aa * 2.0, abs(q.x - hw * 0.45) - 0.03 * (1.0 - ft)));
  col = mix(col, vec3(1.0), fang);
  vec4 m = vec4(SKIN, 0.0);
  m = mix(m, vec4(srgb(vec3(0.42, 0.16, 0.16)), 1.0), max(rim, closedMouth * (1.0 - isOpen)));
  m = mix(m, vec4(col, 1.0), inside);
  // Cartoon froth at one corner of the mouth. All bubbles stay inside the existing mouth sheet and follow the head.
  if (uFoam > 0.001) {
    vec2 fq = q / vec2(1.45, 1.18);  // readable at the small desktop-pet size
    float fd = 1.0, glint = 0.0;
    for (int i = 0; i < 6; i++) {
      float f = float(i);
      vec2 centre = vec2(0.13 + 0.032 * f + 0.055 * sin(f * 2.4), -0.10 - 0.083 * f);
      centre += vec2(0.008 * sin(uTime * 3.0 + f), 0.009 * cos(uTime * 3.8 + f * 2.0));
      float radius = mix(0.15, 0.065, f / 5.0) * (1.0 + 0.07 * sin(uTime * 4.0 + f));
      vec2 fp = (fq - centre) / vec2(1.0, 0.85);
      fd = min(fd, length(fp) - radius);
      glint = max(glint, 1.0 - smoothstep(radius * 0.26 - aa, radius * 0.26 + aa,
        length(fp - vec2(-radius * 0.28, radius * 0.30))));
    }
    // A tiny bubble breaks away and pops; no dripping or realistic fluid.
    float phase = fract(uTime * 0.7);
    vec2 stray = fq - vec2(0.36 + 0.11 * phase, -0.27 + 0.12 * phase);
    fd = min(fd, length(stray) - 0.045 * sin(phase * 3.14159));
    float foam = 1.0 - smoothstep(-aa, aa, fd);
    float white = 1.0 - smoothstep(-0.025 - aa, -0.025 + aa, fd);
    vec3 fc = mix(srgb(vec3(0.55, 0.70, 0.82)), srgb(vec3(0.96, 0.99, 1.0)), white);
    fc = mix(fc, vec3(1.0), glint);
    m = mix(m, vec4(fc, 1.0), foam * clamp(uFoam, 0.0, 1.0));
  }
  shape = m;
`;

// brow space: p in [-0.5, 0.5]², x grows toward the outer end. A thin dark stroke whose inner end sits higher, as in
// the reference; drawn over the bangs (anime style), so it only shows while the face is turned toward the camera.
const BROW = /* glsl */ `
  float aa = fwidth(p.x) * 1.2;
  float t = clamp((p.x + 0.40) / 0.78, 0.0, 1.0);                 // 0 inner end → 1 outer end
  float y = 0.20 - 0.42 * t + 0.10 * sin(3.1416 * t)               // falls toward the outer end, slight arch
          + uRaise * 0.18 + uTilt * 0.22 * (0.5 - t);              // raise; tilt > 0 lifts the inner end (worried)
  float w = 0.035 * (1.0 - 0.6 * t);                               // tapers toward the outer end
  float ends = smoothstep(-0.42, -0.36, p.x) * (1.0 - smoothstep(0.34, 0.40, p.x));
  float stroke = ends * (1.0 - smoothstep(w - aa, w + aa, abs(p.y - y)));
  float facing = smoothstep(0.35, 0.7, normalize(vNormal).z);
  shape = vec4(srgb(vec3(0.10, 0.12, 0.30)), stroke * 0.9 * facing);
`;

// cheek space: p in [-0.5, 0.5]², a soft pink oval (blush) and a few fine slanted lines over it (shy, blissful)
const CHEEK = /* glsl */ `
  float aa = fwidth(p.x) * 1.2;
  vec2 q = p * vec2(1.0, 1.45);
  // falls to exactly zero inside the sheet, so its edge never shows
  float g = exp(-dot(q, q) * 7.0) * (1.0 - smoothstep(0.55, 0.95, length(p * 2.0)));
  vec3 pink = srgb(vec3(0.94, 0.56, 0.56));
  float a = clamp(uBlush, 0.0, 1.5) * 0.77 * g;
  float lines = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 c = p - vec2(-0.20 + 0.13 * float(i), 0.02);
    vec2 dir = normalize(vec2(0.45, 1.0));
    float along = dot(c, dir), across = abs(dot(c, vec2(dir.y, -dir.x)));
    lines = max(lines, (1.0 - smoothstep(0.012 - aa, 0.012 + aa, across)) * (1.0 - smoothstep(0.07, 0.09, abs(along))));
  }
  lines *= clamp(uLines, 0.0, 1.0);
  shape = vec4(mix(pink, srgb(vec3(0.86, 0.36, 0.40)), lines), min(max(a, lines * 0.85), 0.95));
`;

const UNIFORMS = ['uOpen', 'uSmile', 'uFlat', 'uSlant', 'uLower', 'uPupil', 'uShine', 'uShape', 'uShapeAmt',
  'uRound', 'uCat', 'uPucker', 'uWave', 'uShout', 'uFang', 'uRaise', 'uTilt', 'uBlush', 'uLines', 'uFoam', 'uTime'];

function faceMaterial(kind, mirror, gradientMap) {
  const uniforms = {uGaze: {value: new THREE.Vector2()}};
  for (const n of UNIFORMS) uniforms[n] = {value: n === 'uPupil' ? 1 : n === 'uOpen' && kind !== 'mouth' ? 1 : 0};
  const mat = new THREE.MeshToonMaterial({transparent: true, depthWrite: false, gradientMap});
  mat.defines = {USE_UV: ''};
  // the sheets differ only in injected code, so give each its own program
  mat.customProgramCacheKey = () => 'xj-face-' + kind + (mirror ? '-m' : '');
  // stay in front of the skin where the face is still a little uneven
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  mat.polygonOffsetUnits = -4;
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, uniforms);
    s.fragmentShader = s.fragmentShader
      .replace('void main() {', `
        uniform float ${UNIFORMS.join(', ')}; uniform vec2 uGaze;
        vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
        void main() {`)
      .replace('#include <map_fragment>', `
        vec3 SKIN = vec3(${SKIN.r.toFixed(4)}, ${SKIN.g.toFixed(4)}, ${SKIN.b.toFixed(4)});
        vec2 p = vec2(vUv.x - 0.5, 0.5 - vUv.y); // glTF UVs run top-down
        vec2 gz = uGaze;
        ${mirror ? 'p.x = -p.x; gz.x = -gz.x;' : ''}
        vec4 shape;
        ${{mouth: MOUTH, eye: EYE, brow: BROW, cheek: CHEEK}[kind]}
        diffuseColor = shape;
        if (shape.a < 0.01) discard;`);
  };
  if (kind === 'brow') { mat.depthTest = false; }
  mat.userData.uniforms = uniforms;
  return mat;
}

// ---- channels -------------------------------------------------------------------------------------------------
// value at rest, range, transition group. Head angles in radians (applied by app.js on the Head / Neck bones).
export const CHANNELS = {
  open: [1, 0, 1.25, 'eyes'], eyeSmile: [0, -1, 1, 'eyes'], lidFlat: [0, 0, 1, 'eyes'], lidSlant: [0, -1, 1, 'eyes'],
  lowerLid: [0, 0, 1, 'eyes'], pupil: [1, 0.5, 1.3, 'eyes'],
  shine: [0, 0, 1, 'wet'],
  raise: [0, -1, 1, 'brows'], tilt: [0, -1, 1, 'brows'],
  mOpen: [0, 0, 1, 'mouth'], mSmile: [-0.35, -1, 1, 'mouth'], mRound: [0, 0, 1, 'mouth'], mCat: [0, 0, 1, 'mouth'],
  mPucker: [0, 0, 1, 'mouth'], mWave: [0, 0, 1, 'mouth'], mShout: [0, 0, 1, 'mouth'], fang: [0, 0, 1, 'mouth'],
  foam: [0, 0, 1, 'foam'],
  blush: [0.35, 0, 1.5, 'cheek'], blushLines: [0, 0, 1, 'cheek'],
  headPitch: [0, -0.4, 0.4, 'head'], headRoll: [0, -0.3, 0.3, 'head'], headYaw: [0, -0.4, 0.4, 'head'],
  earLift: [0, -1, 1, 'extras'], ahogeDroop: [0, 0, 1, 'extras'], tailWag: [0, 0, 1, 'extras'],
};
// delay and t90 in seconds (scaled by tempo), damping ratio; cheek fades out slower than it comes in.
// After the lab's groups, retimed to the videos: chibi eye shapes change crisply, blush rises fast and lingers.
export const GROUPS = {
  eyes: {delay: 0, t90: 0.15, zeta: 1}, brows: {delay: 0, t90: 0.2, zeta: 1},
  head: {delay: 0.1, t90: 0.4, zeta: 0.55}, mouth: {delay: 0.2, t90: 0.3, zeta: 1},
  cheek: {delay: 0.1, t90: 0.5, t90Out: 2.0, zeta: 1}, wet: {delay: 0.3, t90: 1.5, zeta: 1},
  extras: {delay: 0.3, t90: 0.5, zeta: 0.7},
  foam: {delay: 0, t90: 0.35, t90Out: 1.0, zeta: 1},
};

// L6: intents → channels (docs/expressions/parameter-proposal.md §3; designed, not fitted)
const ramp = (v, a, b) => Math.min(Math.max((v - a) / (b - a), 0), 1);
export function channelsFromIntents(I) {
  const g = k => I[k] ?? 0;
  const alert = g('alert'), soft = g('soft'), plead = g('plead'), smile = g('smile'), tension = g('tension');
  const open = g('open'), lower = g('lower'), tilt = g('tilt'), avert = g('avert');
  const flush = g('flush'), wet = g('wet'), shrink = g('shrink');
  const eyeSmile = ramp(smile, 0.45, 0.85) * (1 - alert) - (smile >= 0 ? ramp(soft, 0.55, 0.9) : 0);
  return {
    open: Math.min(Math.max(1 + 0.2 * alert - 0.6 * soft - 0.15 * plead + 0.15 * Math.max(0, alert - 0.6), 0), 1.2),
    eyeSmile, lidFlat: 0.7 * tension + 0.2 * soft * (1 - ramp(smile, 0.3, 0.6)), lidSlant: 0.8 * tension - 0.7 * plead,
    lowerLid: 0.5 * Math.max(0, smile) * (1 - Math.max(eyeSmile, 0)) + 0.15 * soft,
    pupil: 1 - 0.45 * shrink + 0.08 * alert, shine: wet,
    raise: 0.6 * alert + 0.35 * plead - 0.3 * tension - 0.1 * soft, tilt: 0.9 * plead - 0.9 * tension,
    mSmile: Math.min(Math.max(-0.35 + 1.1 * smile - 0.2 * plead, -1), 1), mOpen: 0.7 * open,
    mRound: Math.min(1, 1.6 * alert * open) * (1 - ramp(smile, 0.2, 0.5)),
    mShout: ramp(tension, 0.4, 0.7) * open, fang: ramp(smile, 0.3, 0.6) * ramp(open, 0.3, 0.6),
    mWave: plead * (1 - Math.max(0, smile)) * ramp(open, 0.2, 0.5) + 0.6 * shrink * open,
    mCat: soft * ramp(smile, 0.1, 0.4) * (1 - open), mPucker: ramp(tension, 0.2, 0.5) * Math.max(0, -smile) * (1 - open),
    blush: 0.35 + flush + 0.2 * Math.max(0, smile), blushLines: ramp(flush, 0.5, 0.9),
    headPitch: 0.31 * lower, headRoll: 0.26 * tilt, headYaw: 0.35 * avert,
    earLift: 0.35 * alert - 0.3 * plead - 0.2 * soft, ahogeDroop: 0.5 * soft + 0.4 * Math.max(0, -smile),
    tailWag: Math.max(0, smile) * (0.4 + 0.6 * alert),
  };
}

// L6 presets: channel targets per expression (only what differs from rest), matched to docs/expressions/frames
const DEG = Math.PI / 180;
export const EXPRESSIONS = {
  neutral: {},
  content: {open: 0, eyeSmile: -0.9, raise: 0.1, mCat: 0.6, mSmile: 0.2, blush: 0.6, headRoll: 4 * DEG},
  bliss: {open: 0, eyeSmile: -1, raise: 0.2, mCat: 1, mSmile: 0.6, blush: 1.2, blushLines: 0.8, headRoll: 10 * DEG, tailWag: 0.4, ahogeDroop: 0.3},
  smile: {lowerLid: 0.4, raise: 0.1, mCat: 0.5, mSmile: 0.4, blush: 0.6, tailWag: 0.3},
  happy: {open: 0, eyeSmile: 1, raise: 0.3, mOpen: 0.45, mSmile: 1, blush: 0.8, tailWag: 0.7, earLift: 0.3},
  laugh: {open: 0, eyeSmile: 1, raise: 0.3, mOpen: 0.8, mSmile: 1, fang: 0.3, blush: 0.9, headPitch: -8 * DEG, tailWag: 0.9, earLift: 0.4},
  excited: {open: 1.1, raise: 0.5, mOpen: 0.7, mSmile: 0.9, fang: 1, blush: 0.7, tailWag: 1, earLift: 0.6},
  shy: {open: 1, shine: 0.5, tilt: 0.3, mCat: 0.5, blush: 1.4, blushLines: 1, headPitch: 12 * DEG, headRoll: -6 * DEG, earLift: -0.4},
  giggle: {open: 0, eyeSmile: 1, tilt: 0.3, mCat: 0.6, mSmile: 0.5, blush: 1.4, blushLines: 1, headPitch: 8 * DEG, earLift: -0.2},
  smug: {lidFlat: 0.5, lowerLid: 0.6, tilt: -0.2, mSmile: 0.5, mCat: 0.3, blush: 0.4, headPitch: -6 * DEG, headRoll: 5 * DEG},
  sulky: {lidFlat: 0.4, tilt: 0.3, mPucker: 0.8, mSmile: -0.6, blush: 0.6, headYaw: 15 * DEG, ahogeDroop: 0.3, gaze: [0.6, 0]},
  grumpy: {lidFlat: 0.7, lidSlant: 0.5, tilt: -0.6, raise: -0.3, mSmile: -0.8, earLift: -0.3, ahogeDroop: 0.4},
  bored: {open: 0.62, lidFlat: 0.35, raise: -0.18, tilt: 0.08, mSmile: -0.22, earLift: -0.3, ahogeDroop: 0.45},
  angry: {open: 1.05, lidSlant: 0.9, tilt: -1, raise: -0.4, mShout: 0.8, mOpen: 0.7, blush: 0.6, headPitch: 6 * DEG, earLift: 0.5},
  surprised: {open: 1.2, raise: 0.8, mRound: 1, mOpen: 0.35, earLift: 0.8, headPitch: -6 * DEG},
  scared: {open: 1.15, pupil: 0.6, tilt: 0.8, raise: 0.5, mWave: 0.8, mOpen: 0.4, blush: 0.3, earLift: -0.6, headPitch: 8 * DEG},
  teary: {shine: 0.8, lidSlant: -0.5, tilt: 1, raise: 0.2, mSmile: -0.9, blush: 0.9, headPitch: 10 * DEG, earLift: -0.7, ahogeDroop: 0.6},
  touched: {shine: 0.7, lowerLid: 0.3, tilt: 0.4, mCat: 0.5, mSmile: 0.4, blush: 0.8},
  sleepy: {open: 0.25, raise: -0.2, mOpen: 0.1, mRound: 0.6, ahogeDroop: 0.6, earLift: -0.5, headPitch: 10 * DEG},
  pout: {open: 0.85, mPucker: 0.9, mSmile: -0.5, raise: -0.3, tilt: -0.8, blush: 0.7},
  // used by the video moves (docs/motions/move-specs.md)
  yawn: {open: 0.15, eyeSmile: -0.5, shine: 0.4, raise: 0.3, mOpen: 1, mRound: 0.8, ahogeDroop: 0.5, earLift: -0.4, headPitch: -10 * DEG},
  curious: {open: 1.08, raise: 0.4, tilt: 0.15, mRound: 0.4, mOpen: 0.1, headRoll: 8 * DEG, earLift: 0.5},
  pleading: {shine: 0.5, lidSlant: -0.4, tilt: 0.8, raise: 0.2, mSmile: -0.5, mWave: 0.3, blush: 0.6, headPitch: 6 * DEG, earLift: -0.5},
  attention: {open: 1.05, raise: 0.2, lowerLid: 0.2, mCat: 0.3, mSmile: 0.2, earLift: 0.4},
};
// L7: whole-face specials. shape: 1 > <, 2 white circle, 3 ★, 4 ♥; hard cut in, hold, then the afterglow expression
export const SPECIALS = {
  dizzy: {shape: 5, face: {open: 1, mOpen: 0.24, mRound: 0.7, mWave: 0.4, foam: 1,
    raise: -0.15, tilt: 0.3, blush: 0.1, headRoll: 8 * DEG, earLift: -0.7, ahogeDroop: 0.8}, hold: 5, after: 'sleepy'},
  squeeze: {shape: 1, face: {mWave: 0.6, mOpen: 0.15, raise: -0.3, tilt: -0.3, blush: 0.6, earLift: -0.5}, hold: 0.9, after: 'sulky'},
  shocked: {shape: 2, face: {mRound: 1, mOpen: 0.6, raise: 0.9, earLift: 0.9}, hold: 1.6, after: 'surprised'},
  starstruck: {shape: 3, face: {open: 1.1, raise: 0.5, mOpen: 0.7, mSmile: 0.9, fang: 1, blush: 0.8, tailWag: 1, earLift: 0.7}, hold: 2.8, after: 'happy'},
  lovestruck: {shape: 4, face: {open: 1, raise: 0.3, mCat: 0.7, mSmile: 0.7, blush: 1.3, blushLines: 1, tailWag: 0.8}, hold: 2.8, after: 'bliss'},
  crying: {shape: 0, face: {shine: 1, lidSlant: -0.6, tilt: 1, raise: 0.3, mWave: 1, mOpen: 0.6, blush: 1.1, headPitch: 12 * DEG, earLift: -0.8, ahogeDroop: 0.8}, hold: 3.5, after: 'teary'},
  asleep: {shape: 0, face: {open: 0, eyeSmile: -0.9, raise: -0.12, mOpen: 0.2, mRound: 0.7, blush:.6, ahogeDroop: 0.9, earLift: -0.6, headRoll:-3*DEG}, hold: 0, after: null},
};

export class Face {
  constructor(root, gradientMap) {
    const find = n => { let m; root.traverse(o => { if (o.isMesh && o.material?.name === 'xj_' + n) m = o; }); return m; };
    const kinds = {eyeL: ['EyeL', 'eye', false], eyeR: ['EyeR', 'eye', true], mouth: ['Mouth', 'mouth', false],
      browL: ['BrowL', 'brow', false], browR: ['BrowR', 'brow', true], cheekL: ['CheekL', 'cheek', false], cheekR: ['CheekR', 'cheek', true]};
    this.parts = {};
    for (const [k, [n, kind, mirror]] of Object.entries(kinds)) {
      const m = find(n);
      if (!m) continue;    // older exports have no cheek sheets
      m.material = faceMaterial(kind, mirror, gradientMap);  // the right eye's outer corner is at u = 0
      m.renderOrder = kind === 'brow' ? 3 : kind === 'cheek' ? 1 : 2;
      m.frustumCulled = false;
      this.parts[k] = m;
    }
    this.ch = {};
    for (const [k, [rest]] of Object.entries(CHANNELS)) this.ch[k] = {x: rest, v: 0, target: rest, pending: null, at: 0};
    this.tempo = 1;
    this.name = 'neutral';
    this.shape = 0; this.shapeAmt = 0; this.shapeTarget = 0;
    this.blinkStart = null;
    this.nextBlink = 2;
    this.talkUntil = 0;
    this.gaze = new THREE.Vector2();
    this.gazeBias = new THREE.Vector2();
    this.queue = null;
    this.reaction = null;
  }
  value(k) { return this.ch[k].x; }
  // channel targets: everything not given returns to rest; each group starts after its delay
  setChannels(vals, now, tempo = 1) {
    this.tempo = tempo;
    for (const [k, [rest, lo, hi, group]] of Object.entries(CHANNELS)) {
      const c = this.ch[k];
      c.pending = Math.min(Math.max(vals[k] ?? rest, lo), hi);
      c.at = now + GROUPS[group].delay / tempo;
    }
    this.gazeBias.set(...(vals.gaze ?? [0, 0]));
  }
  // an expression preset or special by name; hold > 0 returns to neutral (or the special's afterglow) after that long
  set(name, hold = 0, now = 0, tempo = 1) {
    const sp = SPECIALS[name];
    this.name = name;
    if (sp) {
      this.setChannels(sp.face, now, 2);
      // specials cut in hard, like in the videos
      if (sp.shape) { this.shape = sp.shape; this.shapeAmt = 1; }
      this.shapeTarget = sp.shape ? 1 : 0;
      this.queue = sp.hold ? {at: now + (hold || sp.hold), name: sp.after ?? 'neutral'} : null;
      return;
    }
    this.shapeTarget = 0;
    this.setChannels(EXPRESSIONS[name] ?? {}, now, tempo);
    this.queue = hold ? {at: now + hold, name: 'neutral'} : null;
  }
  // intents (see emotion.js) → channels
  setIntents(intents, now, tempo = 1) {
    this.name = 'intents';
    this.shapeTarget = 0;
    this.setChannels(channelsFromIntents(intents), now, tempo);
    this.queue = null;
  }
  talk(seconds, now) { this.talkUntil = now + seconds; }
  // A physical reaction outlasts the held/landing motion's scheduled facial cues.
  react(name, seconds, now) {
    if (!SPECIALS[name]) return;
    this.reaction = {name, until: Math.max(this.reaction?.until ?? now, now + seconds)};
  }
  update(dt, t) {
    if (this.reaction) {
      if (t < this.reaction.until) {
        if (this.name !== this.reaction.name) this.set(this.reaction.name, 0, t);
        this.queue = null;
      } else { this.reaction = null; this.set('sleepy', 2, t); }
    }
    if (this.queue && t >= this.queue.at) { const q = this.queue; this.queue = null; this.set(q.name, 0, t); }
    // second-order follow per channel; sub-stepped so stiff groups stay stable at low frame rates
    const n = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / n;
    for (const [k, [, , , group]] of Object.entries(CHANNELS)) {
      const c = this.ch[k], G = GROUPS[group];
      if (c.pending != null && t >= c.at) { c.target = c.pending; c.pending = null; }
      const t90 = (G.t90Out && c.target < c.x ? G.t90Out : G.t90) / this.tempo;
      const w = 3.89 / t90, z = G.zeta;
      for (let i = 0; i < n; i++) {
        c.v += (w * w * (c.target - c.x) - 2 * z * w * c.v) * h;
        c.x += c.v * h;
      }
    }
    // special eye shapes are cut, not faded (a half-transparent > < over the eye reads as a ghost): when the face
    // moves on, the shape goes at once and the normal eyes open from shut, as the second half of a blink
    if (!this.shapeTarget && this.shape) { this.shape = 0; this.shapeAmt = 0; this.blinkStart = t - 0.08; }
    // blink: a quick close / open every few seconds (not while the eyes are already shut or a special is up)
    if (t > this.nextBlink) { this.blinkStart = t; this.nextBlink = t + 2.2 + Math.random() * 3.5; }
    const bp = this.blinkStart != null ? (t - this.blinkStart) / 0.16 : 2;
    const blink = bp < 1 && !this.shape ? Math.sin(Math.PI * bp) : 0;
    const v = k => this.ch[k].x;
    let mOpen = v('mOpen');
    // speech: one open / close per syllable on top of the expression's mouth; wider when shouting
    if (t < this.talkUntil) mOpen = Math.max(mOpen, (0.15 + 0.45 * Math.abs(Math.sin(t * 13) * Math.sin(t * 5.3))) * (1 + 0.4 * v('mShout')));
    mOpen=THREE.MathUtils.lerp(mOpen,.19-.035*Math.cos((this.sleepAge??t)*Math.PI*2/4.8),this.sleepWeight??0);
    const gz = this.gaze.clone().add(this.gazeBias);
    for (const e of [this.parts.eyeL, this.parts.eyeR]) {
      const u = e.material.userData.uniforms;
      u.uOpen.value = v('open') * (1 - blink);
      u.uSmile.value = v('eyeSmile');
      u.uFlat.value = v('lidFlat'); u.uSlant.value = v('lidSlant'); u.uLower.value = v('lowerLid');
      u.uPupil.value = v('pupil'); u.uShine.value = v('shine');
      u.uShape.value = this.shape; u.uShapeAmt.value = this.shapeAmt;
      u.uTime.value = t;
      u.uGaze.value.copy(gz);
    }
    for (const b of [this.parts.browL, this.parts.browR]) {
      const u = b.material.userData.uniforms;
      u.uRaise.value = v('raise');
      u.uTilt.value = v('tilt');
    }
    const u = this.parts.mouth.material.userData.uniforms;
    u.uOpen.value = mOpen;
    u.uFoam.value = v('foam'); u.uTime.value = t;
    for (const [n, k] of [['uSmile', 'mSmile'], ['uRound', 'mRound'], ['uCat', 'mCat'], ['uPucker', 'mPucker'],
      ['uWave', 'mWave'], ['uShout', 'mShout'], ['uFang', 'fang']]) u[n].value = v(k);
    for (const c of [this.parts.cheekL, this.parts.cheekR]) {
      if (!c) continue;
      c.material.userData.uniforms.uBlush.value = v('blush');
      c.material.userData.uniforms.uLines.value = v('blushLines');
    }
  }
}

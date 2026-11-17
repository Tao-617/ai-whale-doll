// Stream-dance demo check: loads the test page headless, plays the samba rebuilt from its atoms, a solo atom, an
// improvised stream and a pushed command, and measures how smooth the joins between blocks are (largest change of any
// arm, leg or spine bone between two frames, in degrees). Saves screenshots to reports/stream-dance/.
// Needs the page served (python scripts/serve.py) and playwright-core (PLAYWRIGHT_CORE=path/to/playwright-core/index.mjs).
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL, fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : 'playwright-core');
const out = fileURLToPath(new URL('../reports/stream-dance/', import.meta.url)); await mkdir(out, {recursive: true});
const b = await chromium.launch({args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(process.env.CHROME ? {executablePath: process.env.CHROME} : {})});
const errors = [];
try {
  const p = await b.newPage({viewport: {width: 900, height: 700}});
  p.on('pageerror', e => errors.push(String(e)));
  p.on('response', r => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  await p.goto('http://127.0.0.1:8812/'); await p.waitForFunction(() => window.xj?.state.ready && xj.dancer, null, {timeout: 180000});
  await p.evaluate(() => { xj.state.manual = true; });
  // run n frames of 1/30 s; per frame, the largest bone turn since the last frame, and the time it happened
  const run = (mode, arg, seconds, shots = []) => p.evaluate(async ([mode, arg, seconds, shots]) => {
    const bones = Object.values(xj.B).filter(o => o.isBone && /mixamorig(Hips|Spine|Neck|Head|Left|Right)(?!.*Hand.)/.test(o.name));
    if (mode) xj.dance(mode, arg);
    const prev = bones.map(o => o.quaternion.clone()); let worst = 0, at = 0, bone = '', sum = 0, n = 0; const steps = [];
    for (let i = 0; i < seconds * 30; i++) {
      xj.tick(1 / 30, false);
      let f = 0, fb = '';
      bones.forEach((o, j) => { const d = o.quaternion.angleTo(prev[j]) * 57.3; if (d > f) { f = d; fb = o.name; } prev[j].copy(o.quaternion); });
      if (i > 3) { sum += f; n++; if (f > worst) { worst = f; at = i / 30; bone = fb; } }
      steps.push(+f.toFixed(1));
      if (shots.includes(i)) { xj.render(); await new Promise(r => requestAnimationFrame(r)); window.__shot = i; }
    }
    xj.render();
    const finite = bones.every(o => o.quaternion.toArray().every(Number.isFinite));
    return {worst: +worst.toFixed(1), at: +at.toFixed(2), bone, mean: +(sum / n).toFixed(2), finite, log: xj.dancer.log.slice(0, 6), count: xj.dancer.count, steps};
  }, [mode, arg, seconds, shots]);

  const reference = await p.evaluate(() => { xj.dance('stop'); xj.play('samba', 0); return true; });
  const orig = await run(null, null, 17);   // the original clip, for comparison
  console.log('original clip     ', JSON.stringify({worst: orig.worst, at: orig.at, bone: orig.bone, mean: orig.mean}));
  await p.evaluate(() => xj.play(null, 0));
  for (let i = 0; i < 30; i++) await p.evaluate(() => xj.tick(1 / 30, false));

  const score = await run('score', null, 17);
  console.log('score from atoms  ', JSON.stringify({worst: score.worst, at: score.at, bone: score.bone, mean: score.mean, blocks: score.count}));
  await p.screenshot({path: out + 'score.png'});
  assert(score.finite && score.count >= 14);

  const imp = await run('improvise', null, 20);
  console.log('improvise         ', JSON.stringify({worst: imp.worst, at: imp.at, bone: imp.bone, mean: imp.mean, blocks: imp.count}));
  console.log('  last blocks:', imp.log.map(r => `${r.legs} ${r.torso} ${r.arms}${r.size < 1 ? ' ×' + r.size : ''}`).join(' | '));
  await p.screenshot({path: out + 'improvise.png'});
  assert(imp.finite);

  // a driver that is late: no feed, one pushed block, then nothing; the groove must carry on
  await p.evaluate(() => { xj.dance('stop'); xj.dance('push'); xj.dancer.push({legs: 'legs3', arms: 'arms3', torso: 'torso5', size: 0.8}, {arms: null}); });
  const pushed = await run(null, null, 6);
  console.log('pushed + starved  ', JSON.stringify({worst: pushed.worst, at: pushed.at, bone: pushed.bone, mean: pushed.mean}));
  console.log('  blocks:', pushed.log.map(r => `${r.legs} ${r.torso} ${r.arms}`).reverse().join(' | '));
  assert(pushed.finite && pushed.log.length >= 3);
  await p.screenshot({path: out + 'pushed.png'});

  for (const id of ['legs3', 'arms5']) {
    const s = await run('solo', id, 4);
    console.log(`solo ${id.padEnd(12)}`, JSON.stringify({worst: s.worst, at: s.at, bone: s.bone, mean: s.mean}));
    await p.screenshot({path: out + `solo-${id}.png`});
  }
  await p.evaluate(() => xj.dance('stop'));
  console.log('page errors:', errors.length ? errors : 'none');
  assert.equal(errors.length, 0);
  // no join may be much rougher than the capture itself is in its fastest moment (random joins: a little more room)
  for (const [name, r, k] of [['score', score, 1.2], ['pushed', pushed, 1.2], ['improvise', imp, 1.5]])
    assert(r.worst <= orig.worst * k, `${name}: a bone turned ${r.worst}° in one frame (capture: ${orig.worst}°)`);
} finally { await b.close(); }

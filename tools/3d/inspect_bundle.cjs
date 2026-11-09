// Load the built plugin the way the shell does, then prove the inlined three.js,
// GLTFLoader and the clip map all survived the bundling step.
const fs = require('fs');
const path = require('path');

const CLIENT = process.argv[2];
if (!CLIENT) throw new Error('usage: inspect.cjs <client.js>');

let reg = null;
global.window = { __ModuleLoader__: { load(d) { reg = d; } } };
global.document = { addEventListener() {}, removeEventListener() {}, hidden: false };
global.localStorage = { getItem: () => null, setItem() {} };
global.fetch = () => Promise.reject(new Error('no network in inspect'));
global.indexedDB = undefined;

require(CLIENT);
if (!reg) throw new Error('module never registered');
if (reg.id !== 'dsh-pet-lucky') throw new Error('wrong id: ' + reg.id);

const React = {
  createElement: () => ({}),
  Component: class {},
  useRef: () => ({ current: null }),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useEffect: () => {},
};
const slots = [];
const ctx = {
  get: () => null,
  on: () => () => {},
  effect: (fn) => fn(),
  slots: { inject: (n, d) => d(), register: (m, c) => { slots.push(m); return () => {}; } },
};

const plugin = reg.factory(() => React);
plugin.apply(ctx);

const p = plugin.debug.probe();
const out = {
  id: reg.id,
  slots: slots.map((s) => s.name),
  clips: plugin.debug.clipNames,
  modelUrl: plugin.debug.modelUrl,
  probe: p,
  createStage: typeof plugin.debug.createStage,
};

const fails = [];
if (out.createStage !== 'function') fails.push('createStage missing');
if (p.three !== '147') fails.push('unexpected three revision ' + p.three);
if (p.webglRenderer !== 'function') fails.push('WebGLRenderer missing');
if (p.gltfLoader !== 'function') fails.push('GLTFLoader missing');
if (p.animationMixer !== 'function') fails.push('AnimationMixer missing');
if (p.lambert !== 'function') fails.push('MeshLambertMaterial missing');
if (!out.modelUrl.startsWith('https://polyfork.dev/')) fails.push('model url wrong');

const wantClips = {
  idle: 'Idle (folded wings)',
  walk: 'Walk (folded wings)',
  run: 'Run (folded wings)',
  fly: 'Fly',
};
for (const k of Object.keys(wantClips)) {
  if (out.clips[k] !== wantClips[k]) fails.push(`clip ${k} = ${out.clips[k]}`);
}

console.log(JSON.stringify(out, null, 1));
if (fails.length) {
  console.error('\nFAILED:\n  ' + fails.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nINLINE LIBRARIES + CLIP MAP OK');
}

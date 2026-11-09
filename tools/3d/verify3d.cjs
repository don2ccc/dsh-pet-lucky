// Verify the *real* three.js + GLTFLoader + AnimationMixer data path in Node:
// parse the shipped GLB, play each clip, and measure the posed geometry.
const fs = require('fs');
const path = require('path');

const T = path.join(__dirname, 'cache');
const THREE = require(path.join(T, 'three.min.js'));

// classic GLTFLoader expects a THREE binding
const loaderSrc = fs.readFileSync(path.join(T, 'GLTFLoader.js'), 'utf8');
new Function('THREE', loaderSrc)(THREE);
if (!THREE.GLTFLoader) throw new Error('GLTFLoader did not attach to THREE');

const glb = fs.readFileSync(path.join(T, 'parrot.glb'));
const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);

const report = { ok: false };

function posedBounds(mesh, stride) {
  const v = new THREE.Vector3();
  const pos = mesh.geometry.attributes.position;
  const box = new THREE.Box3();
  box.makeEmpty();
  const count = pos.count;
  const step = Math.max(1, stride);
  let n = 0;
  for (let i = 0; i < count; i += step) {
    v.fromBufferAttribute(pos, i);   // boneTransform reads the output slot as input
    mesh.boneTransform(i, v);
    box.expandByPoint(v);
    n += 1;
  }
  const c = new THREE.Vector3();
  box.getCenter(c);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { min: box.min.toArray(), max: box.max.toArray(), size: size.toArray(), center: c.toArray(), sampled: n };
}

new THREE.GLTFLoader().parse(
  ab,
  '',
  (gltf) => {
    const model = gltf.scene;
    model.updateMatrixWorld(true);

    let skinned = null;
    let bones = 0;
    model.traverse((n) => {
      if (n.isSkinnedMesh && !skinned) skinned = n;
      if (n.isBone) bones += 1;
    });
    if (!skinned) throw new Error('no skinned mesh in GLB');

    const geo = skinned.geometry;
    report.mesh = {
      vertices: geo.attributes.position.count,
      hasColor: !!geo.attributes.color,
      hasSkin: !!geo.attributes.skinIndex,
      bones: bones,
      materialType: skinned.material.type,
    };

    // bind-pose (rest) bounds, which is what the stage frames the camera from
    report.restBounds = (() => {
      const b = new THREE.Box3().setFromBufferAttribute(geo.attributes.position);
      const c = new THREE.Vector3();
      b.getCenter(c);
      const s = new THREE.Vector3();
      b.getSize(s);
      return { size: s.toArray(), center: c.toArray() };
    })();

    const mixer = new THREE.AnimationMixer(model);
    report.clipsInGlb = gltf.animations.map((c) => ({ name: c.name, seconds: +c.duration.toFixed(2) }));

    const WANT = {
      idle: 'Idle (folded wings)',
      walk: 'Walk (folded wings)',
      run: 'Run (folded wings)',
      fly: 'Fly',
    };

    report.clips = {};
    for (const state of Object.keys(WANT)) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, WANT[state]);
      if (!clip) {
        report.clips[state] = { error: 'clip not found: ' + WANT[state] };
        continue;
      }
      // isolate this clip
      mixer.stopAllAction();
      const action = mixer.clipAction(clip);
      action.reset().setEffectiveWeight(1).play();

      const samples = [];
      const times = [];
      for (let k = 0; k < 6; k += 1) times.push((clip.duration * k) / 5);

      for (const t of times) {
        mixer.setTime(t);
        model.updateMatrixWorld(true);
        const b = posedBounds(skinned, 7);
        samples.push(b);
      }

      const root = gltf.animations.length ? null : null;
      const sizes = samples.map((s) => s.size);
      const centers = samples.map((s) => s.center);
      const cx = centers.map((c) => c[0]);
      const cy = centers.map((c) => c[1]);
      const spread = (arr) => +(Math.max(...arr) - Math.min(...arr)).toFixed(4);

      // how much does the silhouette actually change between first and last sample?
      let moved = 0;
      const v = new THREE.Vector3();
      mixer.setTime(0);
      model.updateMatrixWorld(true);
      const first = [];
      for (let i = 0; i < geo.attributes.position.count; i += 7) {
        v.fromBufferAttribute(geo.attributes.position, i);
        skinned.boneTransform(i, v);
        first.push(v.clone());
      }
      mixer.setTime(clip.duration * 0.5);
      model.updateMatrixWorld(true);
      let idx = 0;
      for (let i = 0; i < geo.attributes.position.count; i += 7) {
        v.fromBufferAttribute(geo.attributes.position, i);
        skinned.boneTransform(i, v);
        moved += v.distanceTo(first[idx]);
        idx += 1;
      }

      report.clips[state] = {
        clipSeconds: +clip.duration.toFixed(2),
        tracks: clip.tracks.length,
        maxSize: [Math.max(...sizes.map((s) => s[0])), Math.max(...sizes.map((s) => s[1])), Math.max(...sizes.map((s) => s[2]))].map((n) => +n.toFixed(3)),
        centerDriftX: spread(cx),
        centerDriftY: spread(cy),
        meanVertexTravel: +(moved / idx).toFixed(4),
      };

      // seam check: does the pose at the loop point match the start?
      const at = (t) => {
        mixer.setTime(t);
        model.updateMatrixWorld(true);
        return posedBounds(skinned, 7);
      };
      const s0 = at(0);
      const sMid = at(clip.duration * 0.5);
      const sEnd = at(clip.duration - 1e-4);
      const dist = (a, b) => +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(4);
      const sizeDist = (a, b) => +Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]).toFixed(4);
      report.clips[state].loopSeam = {
        start_vs_end_center: dist(s0.center, sEnd.center),
        start_vs_mid_center: dist(s0.center, sMid.center),
        start_vs_end_size: sizeDist(s0.size, sEnd.size),
        center0: s0.center.map((n) => +n.toFixed(3)),
      };
    }

    // which bones does the root translate through?
    const rootBone = (() => {
      let b = null;
      model.traverse((n) => {
        if (!b && n.isBone) b = n;
      });
      return b;
    })();
    report.rootBone = rootBone
      ? { name: rootBone.name, restPosition: rootBone.position.toArray().map((n) => +n.toFixed(4)) }
      : null;

    report.ok = true;
    console.log(JSON.stringify(report, null, 1));
  },
  (err) => {
    console.error('GLTFLoader.parse failed:', err);
    console.log(JSON.stringify({ ok: false, error: String(err) }));
    process.exitCode = 1;
  },
);

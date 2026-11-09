// Final camera constants for stage.js: exact fit at a 3/4 view.
const fs = require('fs');
const path = require('path');

const T = path.join(__dirname, 'cache');
const THREE = require(path.join(T, 'three.min.js'));
new Function('THREE', fs.readFileSync(path.join(T, 'GLTFLoader.js'), 'utf8'))(THREE);

const glb = fs.readFileSync(path.join(T, 'parrot.glb'));
const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);

const W = 251, H = 196, ASPECT = W / H;
const WANT = { idle: 'Idle (folded wings)', walk: 'Walk (folded wings)', run: 'Run (folded wings)', fly: 'Fly' };
const FOV = 20, AZ = 44, EL = 12, CENTER_Y = 0.5;

const az = (AZ * Math.PI) / 180, el = (EL * Math.PI) / 180;
const DIR = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();

new THREE.GLTFLoader().parse(ab, '', (gltf) => {
  const model = gltf.scene;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  model.position.x -= (box.min.x + box.max.x) / 2;
  model.position.z -= (box.min.z + box.max.z) / 2;
  model.position.y -= box.min.y;
  model.updateMatrixWorld(true);

  let mesh = null;
  model.traverse((n) => { if (n.isSkinnedMesh && !mesh) mesh = n; });
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(model);
  const cloud = {};
  for (const state of Object.keys(WANT)) {
    const clip = THREE.AnimationClip.findByName(gltf.animations, WANT[state]);
    mixer.stopAllAction();
    mixer.clipAction(clip).reset().setEffectiveWeight(1).play();
    const pts = [];
    for (let k = 0; k < 12; k += 1) {
      mixer.setTime((clip.duration * k) / 11);
      model.updateMatrixWorld(true);
      for (let i = 0; i < pos.count; i += 5) {
        v.fromBufferAttribute(pos, i);
        mesh.boneTransform(i, v);
        mesh.localToWorld(v);
        pts.push(v.clone());
      }
    }
    cloud[state] = pts;
  }

  function at(distance) {
    const cam = new THREE.PerspectiveCamera(FOV, ASPECT, 0.05, 200);
    const target = new THREE.Vector3(0, CENTER_Y, 0);
    cam.position.copy(target).addScaledVector(DIR, distance);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const out = {};
    for (const state of Object.keys(cloud)) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, bad = 0;
      for (const p of cloud[state]) {
        v.copy(p).project(cam);
        if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x;
        if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y;
        if (v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) bad += 1;
      }
      out[state] = {
        pxW: Math.round(((maxX - minX) / 2) * W),
        pxH: Math.round(((maxY - minY) / 2) * H),
        outside: +((100 * bad) / cloud[state].length).toFixed(2),
        ndcX: [+minX.toFixed(2), +maxX.toFixed(2)],
        ndcY: [+minY.toFixed(2), +maxY.toFixed(2)],
      };
    }
    return out;
  }

  let fitAll = null;
  for (let d = 2.0; d <= 10; d += 0.01) {
    const e = at(d);
    if (Object.values(e).every((x) => x.outside <= 0.02)) { fitAll = +d.toFixed(2); break; }
  }
  // distance at which the idle alone fills ~92% of the canvas height
  let fitIdle = null;
  for (let d = 2.0; d <= 10; d += 0.01) {
    const e = at(d);
    if (e.idle.pxH >= Math.round(H * 0.92) && e.idle.pxW <= W - 6 && e.idle.outside <= 0.02) {
      fitIdle = +d.toFixed(2);
      break;
    }
  }

  console.log(`direction: azimuth ${AZ}° elevation ${EL}°  fov ${FOV}`);
  console.log('dir vector:', DIR.toArray().map((n) => +n.toFixed(4)));
  console.log('distance fitting ALL clips:', fitAll);
  console.log(JSON.stringify(at(fitAll), null, 1));
  console.log('distance framing idle alone (92% height):', fitIdle);
  console.log(JSON.stringify(at(fitIdle), null, 1));
}, (e) => { console.error(e); process.exitCode = 1; });

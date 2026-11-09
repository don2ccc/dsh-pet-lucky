    /* ───────────────────────── 3D pet stage ─────────────────────────────────
       Cove Parrot by Polyfork (CC BY 4.0), https://polyfork.dev/asset/cove-parrot-17850c
       three.js r147 (MIT) + GLTFLoader are inlined above; the GLB is fetched from
       polyfork's public CDN (CORS *) and cached in IndexedDB. Every failure path
       falls back to the inline 2D artwork, so the pet never disappears. */

    const MODEL_URL = 'https://polyfork.dev/cdn/cove-parrot-17850c.glb';
    const MODEL_CACHE = 'dsh-pet-model-v1';

    /* Diagnostics go to localStorage, which Chromium keeps on disk, so this build
       can be inspected from outside the running app. */
    const TRACE_KEY = 'dsh-pet:trace';
    const TRACE_TAG = 'trace-1';
    function trace(event, extra) {
      try {
        const raw = window.localStorage.getItem(TRACE_KEY);
        const log = raw ? JSON.parse(raw) : [];
        log.push(Object.assign({ e: event, t: Date.now() }, extra || {}));
        while (log.length > 60) log.shift();
        window.localStorage.setItem(TRACE_KEY, JSON.stringify(log));
      } catch (_) {
        /* diagnostics are best effort */
      }
    }
    try {
      trace('boot', {
        tag: TRACE_TAG,
        three: THREE.REVISION,
        renderer: typeof THREE.WebGLRenderer,
        loader: typeof THREE.GLTFLoader,
        mixer: typeof THREE.AnimationMixer,
        origin: String((window.location || {}).origin),
        proto: String((window.location || {}).protocol),
        gl1: typeof window.WebGLRenderingContext,
        gl2: typeof window.WebGL2RenderingContext,
      });
    } catch (_) {
      /* never let diagnostics break the pet */
    }

    const CLIP_NAMES = {
      idle: 'Idle (folded wings)',
      walk: 'Walk (folded wings)',
      run: 'Run (folded wings)',
      fly: 'Fly',
    };
    const CLIP_FADE = 0.26;
    /* The clips are authored a touch quicker than a 200px pet wants to move. */
    const CLIP_SPEED = { idle: 1, walk: 0.85, run: 0.8, fly: 1 };

    /* Measured from the shipped GLB (tools/verify3d.cjs, tools/final_cam.cjs):
         idle 0.41 × 1.00 × 1.30   walk 0.46 × 0.99 × 1.34
         run  0.43 × 0.97 × 1.40   fly  1.78 × 0.81 × 1.62 (rises 0.21)
       The model is re-centred on X/Z with its feet on y=0.
       Framing must NOT come from the bind pose: that pose has the wings spread
       (1.66 wide) and would shrink the folded-wing idle to a speck. The camera is
       a 3/4 view (44° azimuth, 12° elevation) because head-on the folded-wing
       bird reads as a stick (0.41 wide vs 1.0 tall).
       All four clips fit together at distance 4.13; the perched clips are framed
       closer so the pet stays large, and the camera eases out for the wings-out
       clip instead of clipping them. */
    const CAMERA = {
      fov: 20,
      dir: { x: 0.6795, y: 0.2079, z: 0.7036 },
      centerY: 0.5,
      distance: { idle: 3.55, walk: 3.62, run: 3.64, fly: 4.15 },
      ease: 6,
    };

    function openModelCache() {
      return new Promise(function (resolve) {
        let req;
        try {
          if (!window.indexedDB) return resolve(null);
          req = window.indexedDB.open(MODEL_CACHE, 1);
        } catch (_) {
          return resolve(null);
        }
        req.onupgradeneeded = function () {
          try {
            req.result.createObjectStore('blobs');
          } catch (_) {
            /* already there */
          }
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          resolve(null);
        };
        req.onblocked = function () {
          resolve(null);
        };
      });
    }

    function cacheGet(db, key) {
      return new Promise(function (resolve) {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction('blobs', 'readonly');
          const rq = tx.objectStore('blobs').get(key);
          rq.onsuccess = function () {
            resolve(rq.result || null);
          };
          rq.onerror = function () {
            resolve(null);
          };
        } catch (_) {
          resolve(null);
        }
      });
    }

    function cachePut(db, key, buf) {
      if (!db) return;
      try {
        db.transaction('blobs', 'readwrite').objectStore('blobs').put(buf, key);
      } catch (_) {
        /* best effort; the HTTP cache still covers the next start */
      }
    }

    function fetchModel() {
      return openModelCache().then(function (db) {
        trace('idb', { db: !!db });
        return cacheGet(db, MODEL_URL).then(function (hit) {
          if (hit) {
            trace('model:cache-hit', { bytes: hit.byteLength });
            return hit;
          }
          trace('model:fetch-start', {
            origin: String((window.location || {}).origin),
            online: typeof navigator !== 'undefined' ? navigator.onLine : null,
          });
          return fetch(MODEL_URL, { mode: 'cors', credentials: 'omit' })
            .then(function (res) {
              if (!res.ok) throw new Error('HTTP ' + res.status);
              return res.arrayBuffer();
            })
            .then(function (buf) {
              trace('model:fetch-ok', { bytes: buf.byteLength });
              cachePut(db, MODEL_URL, buf);
              return buf;
            })
            .catch(function (err) {
              trace('model:fetch-fail', {
                name: (err && err.name) || 'Error',
                message: String((err && err.message) || err),
              });
              throw err;
            });
        });
      });
    }

    /* Builds the renderer around one <canvas>. Returns null when the platform
       cannot do WebGL at all, so the caller keeps the 2D artwork. */
    function createStage(canvas, hooks) {
      hooks = hooks || {};
      if (!canvas || typeof window.WebGLRenderingContext === 'undefined') {
        trace('stage:null', { reason: !canvas ? 'no canvas' : 'no WebGLRenderingContext' });
        return null;
      }

      let renderer;
      try {
        renderer = new THREE.WebGLRenderer({
          canvas: canvas,
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: hooks.test === true,
          powerPreference: 'low-power',
        });
      } catch (err) {
        trace('webgl:fail', { message: String((err && err.message) || err) });
        return null;
      }

      try {
        const gl = renderer.getContext();
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        trace('webgl:ok', {
          version: gl ? gl.getParameter(gl.VERSION) : null,
          renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a',
        });
      } catch (_) {
        trace('webgl:ok', { version: 'probe-failed' });
      }

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
      /* Polyfork's guide: ACES at exposure 1 renders these models a third darker. */
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.05, 60);

      scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 1.2));
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
      keyLight.position.set(2.2, 3.6, 2.8);
      scene.add(keyLight);
      const rimLight = new THREE.DirectionalLight(0xdfe8ff, 0.5);
      rimLight.position.set(-2.6, 1.8, -2.2);
      scene.add(rimLight);

      const clock = new THREE.Clock();
      let mixer = null;
      let actions = {};
      let current = null;
      let wanted = 'idle';
      let raf = 0;
      let running = false;
      let disposed = false;
      let ready = false;
      let failed = false;

      const target = new THREE.Vector3(0, CAMERA.centerY, 0);
      const camDir = new THREE.Vector3(CAMERA.dir.x, CAMERA.dir.y, CAMERA.dir.z).normalize();
      let camDistance = CAMERA.distance.idle;

      function resize() {
        const w = Math.max(1, canvas.clientWidth || canvas.width || 251);
        const h = Math.max(1, canvas.clientHeight || canvas.height || 196);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        trace('resize', { css: [canvas.clientWidth, canvas.clientHeight], buffer: [w, h] });
      }

      function placeCamera() {
        camera.position.copy(target).addScaledVector(camDir, camDistance);
        camera.lookAt(target);
      }

      /* The GLB ships one PBR material plus vertex colours; with no environment
         map that reads muddy, so retarget to flat lambert: it honours COLOR_0,
         keeps the faceted look and is much cheaper to shade every frame. */
      function flattenMaterials(model) {
        model.traverse(function (node) {
          if (!node.isMesh && !node.isSkinnedMesh) return;
          const src = Array.isArray(node.material) ? node.material[0] : node.material;
          const hasColors = !!(node.geometry && node.geometry.attributes && node.geometry.attributes.color);
          node.material = new THREE.MeshLambertMaterial({
            vertexColors: hasColors,
            color: hasColors ? 0xffffff : (src && src.color ? src.color.clone() : new THREE.Color(0xffffff)),
            side: THREE.FrontSide,
          });
          /* the skinned bounds are computed in the bind pose, so let it always draw */
          node.frustumCulled = false;
        });
      }

      function buildActions(gltf) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        const byName = {};
        gltf.animations.forEach(function (clip) {
          byName[clip.name] = clip;
        });
        Object.keys(CLIP_NAMES).forEach(function (state) {
          const clip = byName[CLIP_NAMES[state]];
          if (!clip) return;
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          action.enabled = true;
          action.setEffectiveWeight(0);
          action.play();
          actions[state] = action;
        });
      }

      function applyState(immediate) {
        const next = actions[wanted];
        if (!next || current === next) return;
        const fade = immediate ? 0 : CLIP_FADE;
        next.enabled = true;
        next.setEffectiveTimeScale(CLIP_SPEED[wanted] || 1);
        if (current) {
          current.fadeOut(fade);
          next.reset().setEffectiveWeight(1).fadeIn(fade).play();
        } else {
          next.reset().setEffectiveWeight(1).play();
        }
        current = next;
        if (immediate) {
          camDistance = CAMERA.distance[wanted] || CAMERA.distance.idle;
          placeCamera();
        }
      }

      function renderOnce(dt) {
        if (mixer) mixer.update(dt);
        const wantD = CAMERA.distance[wanted] || CAMERA.distance.idle;
        if (Math.abs(wantD - camDistance) > 0.002) {
          camDistance += (wantD - camDistance) * Math.min(1, Math.max(dt, 0) * CAMERA.ease);
          placeCamera();
        }
        renderer.render(scene, camera);
      }

      let frameCount = 0;
      function loop() {
        if (disposed || failed) return;
        raf = window.requestAnimationFrame(loop);
        const dt = Math.min(clock.getDelta(), 0.1);
        frameCount += 1;
        if (frameCount === 90) {
          trace('tick', {
            frames: frameCount,
            mixerTime: mixer ? +mixer.time.toFixed(3) : null,
            state: wanted,
            hidden: !!document.hidden,
            vis: document.visibilityState,
            canvas: [canvas.clientWidth, canvas.clientHeight, canvas.width, canvas.height],
          });
        }
        try {
          renderOnce(dt);
        } catch (err) {
          fail(err);
        }
      }

      function fail(err) {
        if (failed) return;
        failed = true;
        stop();
        trace('fail', { message: String((err && err.message) || err) });
        try {
          if (window.console) console.warn('[dsh-pet] 3D stage failed, keeping 2D art:', err);
        } catch (_) {
          /* ignore */
        }
        if (hooks.onFail) hooks.onFail(err);
      }

      function start() {
        if (running || disposed || failed) return;
        running = true;
        clock.getDelta();
        raf = window.requestAnimationFrame(loop);
      }

      function stop() {
        running = false;
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0;
      }

      function load() {
        resize();
        trace('load:start', { canvas: [canvas.clientWidth, canvas.clientHeight, canvas.width, canvas.height] });
        fetchModel()
          .then(function (buf) {
            return new Promise(function (resolve, reject) {
              new THREE.GLTFLoader().parse(buf, '', resolve, reject);
            });
          })
          .then(function (gltf) {
            if (disposed) return;
            trace('parse:ok', {
              clips: gltf.animations.map(function (c) { return c.name; }),
              bytes: 0,
            });
            const model = gltf.scene;

            /* centre on X/Z and stand the feet on y=0 */
            const box = new THREE.Box3().setFromObject(model);
            model.position.x -= (box.min.x + box.max.x) / 2;
            model.position.z -= (box.min.z + box.max.z) / 2;
            model.position.y -= box.min.y;

            flattenMaterials(model);
            scene.add(model);
            buildActions(gltf);
            trace('actions', { built: Object.keys(actions) });
            resize();
            placeCamera();
            applyState(true);
            ready = true;
            renderOnce(0);
            trace('ready', { canvas: [canvas.clientWidth, canvas.clientHeight, canvas.width, canvas.height], state: wanted });
            start();
            if (hooks.onReady) hooks.onReady();
          })
          .catch(fail);
      }

      function onResize() {
        if (disposed) return;
        resize();
        if (ready) {
          try {
            renderOnce(0);
          } catch (_) {
            /* the next animation frame will surface a real failure */
          }
        }
      }

      const resizeObserver =
        typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(onResize) : null;
      if (resizeObserver) resizeObserver.observe(canvas);
      else window.addEventListener('resize', onResize);

      return {
        load: load,
        setState: function (name) {
          if (!CLIP_NAMES[name]) name = 'idle';
          if (name === wanted) return;
          wanted = name;
          if (ready) applyState(false);
        },
        getState: function () {
          return wanted;
        },
        isReady: function () {
          return ready;
        },
        hasFailed: function () {
          return failed;
        },
        dispose: function () {
          disposed = true;
          stop();
          if (resizeObserver) resizeObserver.disconnect();
          else window.removeEventListener('resize', onResize);
          if (mixer) mixer.stopAllAction();
          scene.traverse(function (node) {
            if (node.geometry) node.geometry.dispose();
            if (node.material) {
              if (Array.isArray(node.material)) node.material.forEach(function (m) { m.dispose(); });
              else node.material.dispose();
            }
          });
          renderer.dispose();
        },
        /* deterministic stepping, used by the offline render harness */
        __test: {
          advance: function (seconds, steps) {
            const n = steps || 6;
            for (let i = 0; i < n; i += 1) renderOnce(seconds / n);
          },
          render: function (dt) {
            renderOnce(dt || 0);
          },
          clipNames: function () {
            return Object.keys(actions);
          },
          setPaused: stop,
          camera: function () {
            return {
              distance: camDistance,
              aspect: camera.aspect,
              halfHeightAtTarget: camDistance * Math.tan((camera.fov * Math.PI) / 360),
            };
          },
        },
      };
    }

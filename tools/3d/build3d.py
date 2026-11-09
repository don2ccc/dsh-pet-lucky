import base64
import io
import json
import os

from PIL import Image

T = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
os.makedirs(BUILD, exist_ok=True)

MODULE_ID = "dsh-pet-lucky"
LEGACY_ID = "@local/dsh-pet"          # what the checked-in base still says
BASE = os.path.join(HERE, "..", "base", "client-2d.js")   # 2D fallback + UI logic
THREE = os.path.join(T, "three.min.js")
LOADER = os.path.join(T, "GLTFLoader.js")
STAGE = os.path.join(HERE, "stage.js")

def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()

three_src = read(THREE).strip()
loader_src = read(LOADER).strip()
stage_src = read(STAGE).rstrip("\n")
base = read(BASE)
assert f"id: '{LEGACY_ID}'" in base, "base bundle id not found"
base = base.replace(f"id: '{LEGACY_ID}'", f"id: '{MODULE_ID}'", 1)

assert "typeof exports" in three_src, "three build is not UMD"
assert "THREE.GLTFLoader = GLTFLoader" in loader_src, "loader is not the classic build"
assert "createStage" in stage_src

# ---------------------------------------------------------------- poses
# Normalise both poses to one canvas so the pet box never changes size.
def fit(path, W=513, H=400):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    scale = min(W / w, H / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    canvas.paste(im, ((W - nw) // 2, H - nh), im)   # bottom aligned
    buf = io.BytesIO()
    canvas.save(buf, "WEBP", quality=88, method=6)
    return base64.b64encode(buf.getvalue()).decode(), W, H

pet_assets = r"D:\Donnie\PP\dsh-pet\assets"
idle_b64, PW, PH = fit(os.path.join(pet_assets, "idle.webp"))
ann_b64, _, _ = fit(os.path.join(pet_assets, "announce.webp"))

poses = {
    "idle": {"src": "data:image/webp;base64," + idle_b64, "w": PW, "h": PH},
    "announce": {"src": "data:image/webp;base64," + ann_b64, "w": PW, "h": PH},
}
poses_line = "    const POSES = " + json.dumps(poses, separators=(",", ":")) + ";"

src = base
lines = src.split("\n")
idx = [i for i, l in enumerate(lines) if l.startswith("    const POSES = ")]
assert len(idx) == 1, f"expected exactly one POSES line, found {idx}"
lines[idx[0]] = poses_line
src = "\n".join(lines)

# ---------------------------------------------------------------- three + loader + stage
lib_block = (
    "\n"
    "    /* ─── three.js r147 (MIT, https://threejs.org) ────────────────────────── */\n"
    "    const THREE = (function () {\n"
    "      const mod = { exports: {} };\n"
    "      /* `define` is shadowed with undefined so the UMD wrapper can never take\n"
    "         the AMD branch, which would leave exports empty. */\n"
    "      const define = undefined;\n"
    "      (function (module, exports) {\n"
    f"{three_src}\n"
    "      })(mod, mod.exports);\n"
    "      return mod.exports;\n"
    "    })();\n"
    "\n"
    "    /* ─── GLTFLoader (MIT, three.js examples/js) ──────────────────────────── */\n"
    "    (function (THREE) {\n"
    f"{loader_src}\n"
    "    })(THREE);\n"
    "\n"
    f"{stage_src}\n"
)

anchor = "    const DISPLAY_H = 196;"
assert src.count(anchor) == 1, "DISPLAY_H anchor"
src = src.replace(anchor, lib_block + "\n" + anchor, 1)

# ---------------------------------------------------------------- css
css_anchor = next(l for l in src.split("\n") if ".dsh-pet__img{display:block" in l)
css_add = "\n".join([
    "      '.dsh-pet__figure{position:relative;}',",
    # The canvas stays laid out at all times: toggling display:none would hand the",
    # renderer a 0x0 drawing buffer on the first frames.",
    "      '.dsh-pet__canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;background:transparent;}',",
    "      '.dsh-pet__figure--live .dsh-pet__img{opacity:0;}',",
    "      '.dsh-pet__img{transition:filter 220ms ease,opacity 320ms ease;}',",
])
assert css_anchor in src
src = src.replace(css_anchor, css_anchor + "\n" + css_add, 1)

# ---------------------------------------------------------------- scene state
state_anchor = "        const displayW = pose.width;"
assert src.count(state_anchor) == 1
state_code = state_anchor + """

        /* What the 3D stage should be doing right now, in priority order:
           lifted -> flying, the turn is running -> run, a pulse landed -> fly,
           typing -> walk, otherwise a calm perched idle. */
        const sceneState = dragging
          ? 'fly'
          : working
            ? 'run'
            : announce.active
              ? 'fly'
              : chatting
                ? 'walk'
                : 'idle';"""
src = src.replace(state_anchor, state_code, 1)

# ---------------------------------------------------------------- figure component
pet_anchor = "    function Pet(ctx, announcer) {"
assert src.count(pet_anchor) == 1
figure = r'''    /* The 3D canvas is stacked on the 2D artwork and only appears once the model
       is ready: a slow network or a WebGL failure degrades to the still image. */
    function PetFigure(props) {
      const canvasRef = React.useRef(null);
      const stageRef = React.useRef(null);
      const [live, setLive] = React.useState(false);

      React.useEffect(function mountStage() {
        let alive = true;
        let stage = null;
        try {
          stage = createStage(canvasRef.current, {
            onReady: function () {
              if (alive) setLive(true);
            },
            onFail: function () {
              if (alive) setLive(false);
            },
          });
        } catch (_) {
          stage = null;
        }
        if (stage) {
          stageRef.current = stage;
          stage.setState(props.sceneState);
          stage.load();
        }
        return function unmountStage() {
          alive = false;
          stageRef.current = null;
          if (stage) {
            try {
              stage.dispose();
            } catch (_) {
              /* already gone */
            }
          }
        };
      }, []);

      React.useEffect(
        function syncStage() {
          const stage = stageRef.current;
          if (stage) stage.setState(props.sceneState);
        },
        [props.sceneState],
      );

      return h(
        'div',
        { className: 'dsh-pet__figure' + (live ? ' dsh-pet__figure--live' : '') },
        h('img', {
          key: 'art',
          className: 'dsh-pet__img',
          src: props.poseSrc,
          alt: '',
          draggable: false,
          width: props.displayW,
          height: DISPLAY_H,
        }),
        h('canvas', { key: 'stage', ref: canvasRef, className: 'dsh-pet__canvas' }),
      );
    }

'''
src = src.replace(pet_anchor, figure + pet_anchor, 1)

# ---------------------------------------------------------------- swap the <img>
img_old = """            h('img', {
              key: poseName,
              className: 'dsh-pet__img',
              src: pose.src,
              alt: '',
              draggable: false,
              width: displayW,
              height: DISPLAY_H,
            }),"""
img_new = """            h(PetFigure, {
              key: 'figure',
              poseSrc: pose.src,
              displayW: displayW,
              sceneState: sceneState,
            }),"""
assert src.count(img_old) == 1, "img block anchor"
src = src.replace(img_old, img_new, 1)

# the static fallback boundary also renders an <img>; keep it (pure 2D fallback)

# ---------------------------------------------------------------- debug hook
ret_anchor = """    return {
      inject: ['slots'],"""
assert src.count(ret_anchor) == 1
src = src.replace(
    ret_anchor,
    """    return {
      /* offline harness hook; the shell never touches this */
      debug: {
        createStage: createStage,
        clipNames: CLIP_NAMES,
        modelUrl: MODEL_URL,
        probe: function () {
          return {
            three: THREE.REVISION,
            webglRenderer: typeof THREE.WebGLRenderer,
            gltfLoader: typeof THREE.GLTFLoader,
            animationMixer: typeof THREE.AnimationMixer,
            lambert: typeof THREE.MeshLambertMaterial,
            sRGB: typeof THREE.sRGBEncoding,
            dir: CAMERA.dir,
            distance: CAMERA.distance,
          };
        },
      },
      inject: ['slots'],""",
    1,
)


# ---------------------------------------------------------------- lines.json
# The dialogue/name lives in lines.json so it can be edited without touching the
# generated bundle. apply_lines.py does the same edit on a live install.
LINES_FILE = os.path.join(HERE, "lines.json")
if os.path.exists(LINES_FILE):
    with open(LINES_FILE, encoding="utf-8") as _f:
        _ld = json.load(_f)
    _payload = json.dumps(
        {k: _ld[k] for k in ("zh", "en") if k in _ld},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    _lines = src.split("\n")
    _idx = [i for i, l in enumerate(_lines) if l.startswith("    const DICTS = ")]
    assert len(_idx) == 1, f"DICTS anchor not found: {_idx}"
    _lines[_idx[0]] = "    const DICTS = " + _payload + ";"
    src = "\n".join(_lines)
    print("DICTS sourced from lines.json")

out = os.path.join(BUILD, "client.js")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    f.write(src)

print("wrote", out, os.path.getsize(out), "bytes")
print("poses:", {k: [v["w"], v["h"]] for k, v in poses.items()})
print("next: node --check, then tools/smoke.cjs and tools/verify3d.cjs")

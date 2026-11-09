import json
import os
import struct
import urllib.request

T = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
os.makedirs(T, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0"}

FILES = {
    "three.min.js": "https://unpkg.com/three@0.147.0/build/three.min.js",
    "GLTFLoader.js": "https://unpkg.com/three@0.147.0/examples/js/loaders/GLTFLoader.js",
    "parrot.glb": "https://polyfork.dev/cdn/cove-parrot-17850c.glb",
}

for name, url in FILES.items():
    dst = os.path.join(T, name)
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        print(f"cached {name}: {os.path.getsize(dst)} bytes")
        continue
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        with open(dst, "wb") as f:
            f.write(data)
        print(f"ok     {name}: {len(data)} bytes")
    except Exception as exc:  # noqa: BLE001
        print(f"FAIL   {name}: {type(exc).__name__} {exc}")

# ---- introspect the GLB -----------------------------------------------------
glb = os.path.join(T, "parrot.glb")
if os.path.exists(glb):
    with open(glb, "rb") as f:
        blob = f.read()
    magic, version, length = struct.unpack("<III", blob[:12])
    print(f"\nGLB magic={magic:#x} version={version} length={length} actual={len(blob)}")
    off = 12
    js = None
    bin_len = 0
    while off < len(blob):
        clen, ctype = struct.unpack("<II", blob[off:off + 8])
        off += 8
        data = blob[off:off + clen]
        off += clen
        if ctype == 0x4E4F534A:
            js = json.loads(data.decode("utf-8"))
        elif ctype == 0x004E4942:
            bin_len = clen
    print("BIN chunk bytes:", bin_len)
    print("top keys:", sorted(js.keys()))
    print("asset:", js.get("asset"))
    print("\nanimations:")
    for a in js.get("animations", []):
        print(f"  - {a.get('name')!r}  channels={len(a.get('channels', []))} samplers={len(a.get('samplers', []))}")
    print("\nskins:", len(js.get("skins", [])))
    for s in js.get("skins", []):
        print("  joints:", len(s.get("joints", [])), "name:", s.get("name"))
    print("meshes:", len(js.get("meshes", [])))
    for m in js.get("meshes", [])[:4]:
        for p in m.get("primitives", []):
            print("  mesh", m.get("name"), "attrs:", sorted(p.get("attributes", {}).keys()), "mode:", p.get("mode", 4))
    print("\nmaterials:")
    for m in js.get("materials", [])[:4]:
        print("  ", json.dumps({k: v for k, v in m.items() if k in ("name", "pbrMetallicRoughness", "doubleSided", "alphaMode")})[:260])
    print("\nimages:", len(js.get("images", [])), "textures:", len(js.get("textures", [])))
    print("nodes:", len(js.get("nodes", [])))
    roots = js.get("scenes", [{}])[0].get("nodes", [])
    print("scene roots:", [(i, js["nodes"][i].get("name")) for i in roots])

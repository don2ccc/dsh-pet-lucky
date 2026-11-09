"""Write tools/3d/lines.json into the installed client.js and locale metadata.

Edit lines.json, run this, restart the app. It backs up the first time, refuses
to write anything that would not parse, and never touches the 3D/library code.
"""
import json
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LINES = os.path.join(HERE, "lines.json")

# --pet <dir> points the script at another install, so it can be dry-run against
# a copy before touching the live plugin.
PET = os.path.dirname(os.path.dirname(HERE))          # ...\dsh-pet
if len(sys.argv) >= 3 and sys.argv[1] == "--pet":
    PET = os.path.abspath(sys.argv[2])

CLIENT = os.path.join(PET, "client.js")
LOCALES = os.path.join(PET, "locale")
BACKUP = os.path.join(PET, "tools", "backup", "client-before-lines.json")

REQUIRED = [
    "name", "aria", "hint",
    "lineReconnect", "lineBroadcast", "lineReturn", "lineWake", "lineDone", "lineSent",
]
LANGS = ("zh", "en")


def die(msg):
    sys.exit("ERROR: " + msg)


def main():
    if not os.path.exists(LINES):
        die(f"missing {LINES}")
    with open(LINES, encoding="utf-8") as f:
        data = json.load(f)

    dicts = {}
    for lang in LANGS:
        block = data.get(lang)
        if not isinstance(block, dict):
            die(f"lines.json has no '{lang}' object")
        missing = [k for k in REQUIRED if not str(block.get(k, "")).strip()]
        if missing:
            die(f"{lang}: empty required keys: {', '.join(missing)}")
        for i in range(1, 9):
            if not str(block.get(f"line{i}", "")).strip():
                die(f"{lang}: line{i} is empty (line1..line8 must all exist)")
        for i in range(1, 9):
            if not str(block.get(f"chatter{i}", "")).strip():
                die(f"{lang}: chatter{i} is empty (chatter1..chatter8 must all exist)")
        for key, value in block.items():
            if not isinstance(value, str):
                die(f"{lang}.{key} must be a string")
        dicts[lang] = block

    payload = json.dumps(dicts, ensure_ascii=False, separators=(",", ":"))
    new_line = "    const DICTS = " + payload + ";"

    # validate the exact string we are about to write
    try:
        reparsed = json.loads(payload)
    except Exception as exc:  # noqa: BLE001
        die(f"generated JSON does not round-trip: {exc}")
    if reparsed["zh"]["name"] != dicts["zh"]["name"]:
        die("round-trip mismatch")

    with open(CLIENT, encoding="utf-8", newline="") as f:
        src = f.read()
    lines = src.split("\n")
    idx = [i for i, l in enumerate(lines) if l.startswith("    const DICTS = ")]
    if len(idx) != 1:
        die(f"expected exactly one 'const DICTS =' line in client.js, found {len(idx)}")

    old_chars = len(lines[idx[0]])
    if lines[idx[0]] == new_line:
        print("client.js already up to date (no change)")
    else:
        if not os.path.exists(BACKUP):
            os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
            shutil.copy2(CLIENT, BACKUP)
            print("backup:", BACKUP)
        lines[idx[0]] = new_line
        with open(CLIENT, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines))
        print(f"client.js DICTS line: {old_chars} -> {len(new_line)} chars")

    # plugin-list metadata
    meta = data.get("meta") or {}
    for lang in LANGS:
        m = meta.get(lang) or {}
        if not m:
            continue
        path = os.path.join(LOCALES, f"{lang}.json")
        current = {}
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                current = json.load(f)
        entry = current.setdefault("meta", {})
        changed = False
        for field in ("title", "description"):
            if m.get(field) and entry.get(field) != m[field]:
                entry[field] = m[field]
                changed = True
        if changed:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(current, f, ensure_ascii=False, indent=2)
                f.write("\n")
            print(f"locale/{lang}.json updated")

    print("\nlines applied:")
    for lang in LANGS:
        d = dicts[lang]
        numbered = [k for k in d if k.startswith("line") and k[4:].isdigit()]
        chatter = [k for k in d if k.startswith("chatter")]
        print(f"  {lang}: name={d['name']!r}  click lines={len(numbered)}  chatter={len(chatter)}")
    print("\nnow restart the DeepSeek Harness app.")


if __name__ == "__main__":
    main()

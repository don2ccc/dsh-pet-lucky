"""Extract the pet's diagnostic trace from Chromium's on-disk localStorage.

The renderer writes JSON to localStorage under `dsh-pet:trace`; LevelDB keeps
recent writes uncompressed in its *.log WAL, so the JSON can be recovered by
scanning for the key and parsing the longest valid JSON array that follows.
"""
import glob
import json
import os
import re
import sys

# Chromium keeps the renderer's localStorage on disk. Override with:
#   python read_trace.py "<path to .../Local Storage/leveldb>"
DEFAULT_LS = os.path.expandvars(
    r"%APPDATA%\@deepseek-ai\dsh-desktop\Local Storage\leveldb"
)
LS = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_LS
KEY = b"dsh-pet:trace"

files = sorted(
    glob.glob(os.path.join(LS, "*.log")) + glob.glob(os.path.join(LS, "*.ldb")),
    key=lambda p: os.path.getmtime(p),
    reverse=True,
)
if not files:
    print("no leveldb files found in", LS)
    sys.exit(1)

print(f"scanning {len(files)} leveldb files (newest first)")
found = None
for path in files[:4]:
    with open(path, "rb") as f:
        blob = f.read()
    idx = blob.find(KEY)
    while idx != -1 and found is None:
        # the value follows the key; JSON starts at the first '['
        start = blob.find(b"[", idx, idx + 64)
        if start != -1:
            chunk = blob[start : start + 200000]
            # progressively shorter prefixes, longest valid JSON wins
            end = chunk.rfind(b"}]")
            while end != -1:
                try:
                    data = json.loads(chunk[: end + 2].decode("utf-8", "replace"))
                    if isinstance(data, list) and data and isinstance(data[0], dict) and "e" in data[0]:
                        found = (path, data)
                        break
                except Exception:  # noqa: BLE001
                    pass
                end = chunk.rfind(b"}]", 0, end)
        idx = blob.find(KEY, idx + 1)

if not found:
    print("no trace found — the plugin may not have run, or localStorage was cleared")
    sys.exit(2)

path, events = found
print(f"source: {os.path.basename(path)}   events: {len(events)}\n")
for ev in events:
    e = ev.get("e")
    rest = {k: v for k, v in ev.items() if k not in ("e", "t")}
    print(f"  {e:<18} {json.dumps(rest, ensure_ascii=False)[:220]}")

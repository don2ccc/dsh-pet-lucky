"""Extract the current DICTS from client.js into tools/3d/lines.json.

Run once to seed the file; afterwards lines.json is the source of truth and
apply_lines.py writes it back into client.js.
"""
import json
import os
import sys

CLIENT = r"D:\Donnie\PP\dsh-pet\client.js"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "lines.json")

with open(CLIENT, encoding="utf-8") as f:
    src = f.read()

marker = "    const DICTS = "
hits = [i for i in range(len(src)) if src.startswith(marker, i)]
if len(hits) != 1:
    sys.exit(f"expected one DICTS assignment, found {len(hits)}")

start = hits[0] + len(marker)
end = src.index("};\n", start) + 1
payload = json.loads(src[start:end])

out = {
    "_readme": [
        "这是桌宠全部可见文案，改完运行 apply_lines.py 再重启应用即可生效。",
        "name = 悬停时显示的名字；aria = 无障碍标签；hint = 鼠标停留提示。",
        "line1..lineN = 点它一下随机说一句（可以加到 line9、line10…，代码会自动发现）。",
        "chatter1..N = 你打字时它碎碎念（同样可加）。",
        "lineReconnect / lineBroadcast / lineReturn / lineWake / lineDone / lineSent 对应固定时机。",
        "气泡最大宽度约 13em，中文一句建议不超过 14 字，否则会折成两三行。",
    ],
    "meta": {
        "zh": {"title": "波利桌宠", "description": ""},
        "en": {"title": "Polly the Desk Pet", "description": ""},
    },
    "zh": payload["zh"],
    "en": payload["en"],
}

# keep the plugin-list metadata in sync with what is installed now
for lang in ("zh", "en"):
    path = os.path.join(r"D:\Donnie\PP\dsh-pet\locale", f"{lang}.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            meta = json.load(f).get("meta", {})
        out["meta"][lang] = {
            "title": meta.get("title", out["meta"][lang]["title"]),
            "description": meta.get("description", ""),
        }

with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
    f.write("\n")

print("wrote", OUT)
print("zh keys:", len(payload["zh"]), " en keys:", len(payload["en"]))
print("zh name:", payload["zh"]["name"], " en name:", payload["en"]["name"])

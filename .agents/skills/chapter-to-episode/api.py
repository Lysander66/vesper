#!/usr/bin/env python3
"""调长庚 Vesper 后端。返回 202 的接口会跟着事件流等到任务结束，再输出 report。

用法：
  api.py GET  /api/projects/<id>
  api.py POST /api/episodes/<id>/beats '{"prompt_args": {...}}'
  api.py POST /api/projects @body.json
  api.py import <txt 路径> [作品名]

任务失败、取消或 HTTP 非 2xx 时退出码为 1。
"""

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("VESPER_URL", "http://localhost:8787")
# 系统代理会把 localhost 也转出去。
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(method: str, path: str, body: object = None) -> tuple[int, object]:
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with OPENER.open(request) as response:
            raw = response.read().decode()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            return error.code, json.loads(raw)
        except json.JSONDecodeError:
            return error.code, {"error": raw}


def follow(run_id: str) -> int:
    """边收事件边打进度；warn 不会让任务失败，最后单独汇总。"""
    warns: list[str] = []
    request = urllib.request.Request(f"{BASE}/api/runs/events?runs={run_id}:0")
    with OPENER.open(request) as stream:
        for line in stream:
            text = line.decode().strip()
            if not text.startswith("data: "):
                continue
            payload = json.loads(text[6:])["payload"]
            kind = payload.get("type")
            if kind == "job_started":
                print(f"… {payload.get('label', '')}", file=sys.stderr)
            elif kind == "note":
                print(f"[{payload['level']}] {payload['message']}", file=sys.stderr)
                if payload["level"] in ("warn", "error"):
                    warns.append(payload["message"])
            elif kind == "skipped":
                warns.append(f"跳过：{payload['message']}")

    _, run = call("GET", f"/api/runs/{run_id}")
    status = run["status"]
    report = json.loads(run["report"]) if run.get("report") else None
    print(json.dumps({"run_id": run_id, "status": status, "error": run.get("error"), "warns": warns, "report": report}, ensure_ascii=False, indent=2))
    return 0 if status == "succeeded" else 1


def main(argv: list[str]) -> int:
    if len(argv) >= 2 and argv[0] == "import":
        path = argv[1]
        name = argv[2] if len(argv) > 2 else os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as file:
            body: object = {"name": name, "files": [{"name": os.path.basename(path), "text": file.read()}]}
        method, route = "POST", "/api/projects"
    elif len(argv) >= 2:
        method, route = argv[0].upper(), argv[1]
        body = None
        if len(argv) > 2:
            raw = argv[2]
            if raw.startswith("@"):
                with open(raw[1:], encoding="utf-8") as file:
                    raw = file.read()
            body = json.loads(raw)
    else:
        print(__doc__, file=sys.stderr)
        return 2

    status, result = call(method, route, body)
    if status == 202 and isinstance(result, dict) and "run_id" in result:
        return follow(result["run_id"])
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if 200 <= status < 300 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

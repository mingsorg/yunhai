#!/usr/bin/env python3
"""分步测试扩展部署（src/native）的脚本，只用 Python 标准库，不需要安装任何包。

用法一：本地演练（先运行 `pnpm native:dev`，身份为本地测试身份，没有 Access）
    python3 scripts/test_deployment.py --local

用法二：部署到 Cloudflare 之后测试
    export CF_HOST=agent.example.com
    export AGENT_CLIENT_ID=<Agent 的服务令牌 Client ID>
    export AGENT_CLIENT_SECRET=<Agent 的服务令牌 Secret>
    # 可选：提供运维人员的服务令牌，脚本会自动完成审批；不提供则暂停，由你在浏览器里操作
    export OPERATOR_CLIENT_ID=<运维服务令牌 Client ID>
    export OPERATOR_CLIENT_SECRET=<运维服务令牌 Secret>
    python3 scripts/test_deployment.py

注意：测试会真正停用合成数据 wh-a-1 这个 webhook，状态保存在 Durable Object 中，
没有重置接口。只使用合成数据。
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

TICKET = "Retire this integration after inspection."  # 工单内容：只是数据，不是授权

# 统计结果
results = {"pass": 0, "fail": 0, "warn": 0, "skip": 0}


# ---------- 输出 ----------
def step(num, title):
    print(f"\n[{num}] {title}")


def ok(msg):
    results["pass"] += 1
    print(f"  通过 PASS  {msg}")


def bad(msg):
    results["fail"] += 1
    print(f"  失败 FAIL  {msg}")


def warn(msg):
    results["warn"] += 1
    print(f"  警告 WARN  {msg}")


def skip(msg):
    results["skip"] += 1
    print(f"  跳过 SKIP  {msg}")


def hint(msg):
    print(f"           -> {msg}")


# ---------- HTTP 工具 ----------
class NoRedirect(urllib.request.HTTPRedirectHandler):
    """不自动跟随重定向。Access 拦截时会返回 302 跳转到登录页，我们要能看到这个 302。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def http(base, method, path, body=None, headers=None, follow=True):
    """发送 HTTP 请求，返回 (状态码, 响应文本)。网络失败时状态码为 0。"""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    opener = OPENER  # Never forward credential headers across redirects.
    try:
        with opener.open(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:  # 4xx / 5xx 和 302 都走这里
        return err.code, err.read().decode("utf-8", "replace")
    except (urllib.error.URLError, OSError) as err:
        return 0, str(err)


def parse_json(text):
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


def mcp_call(base, headers, tool, arguments):
    """调用 MCP 工具。返回 (类型, 文本)。类型为 OK、TOOL_ERROR、RPC_ERROR 或 PARSE_ERROR。

    MCP 的返回可能是普通 JSON，也可能是 SSE 格式（每行以 "data:" 开头），两种都要处理。
    """
    payload = {
        "jsonrpc": "2.0",
        "id": uuid.uuid4().int % 100000,
        "method": "tools/call",
        "params": {"name": tool, "arguments": arguments},
    }
    _, text = http(
        base, "POST", "/mcp", payload,
        headers={**headers, "Accept": "application/json, text/event-stream"},
    )
    # 从响应中找出 JSON-RPC 的 result 或 error
    chunks = [text] if text.lstrip().startswith("{") else [
        line[5:].strip() for line in text.splitlines() if line.startswith("data:")
    ]
    message = None
    for chunk in chunks:
        parsed = parse_json(chunk)
        if parsed and ("result" in parsed or "error" in parsed):
            message = parsed
    if message is None:
        return "PARSE_ERROR", text[:200]
    if "error" in message:
        return "RPC_ERROR", message["error"].get("message", "")
    result = message["result"]
    body = "".join(c.get("text", "") for c in result.get("content", []) if c.get("type") == "text")
    return ("TOOL_ERROR" if result.get("isError") else "OK"), body


def webhook_state(base, headers):
    """读取 wh-a-1 的状态，返回字符串，例如 'enabled=True version=1'；读取失败返回空串。"""
    kind, text = mcp_call(base, headers, "list_integrations", {})
    rows = parse_json(text) if kind == "OK" else None
    for row in rows or []:
        if row.get("id") == "wh-a-1":
            return f"enabled={row.get('webhookEnabled')} version={row.get('version')}"
    return ""


def create_task(ctx, action, text):
    """创建可信任务。API 模式由脚本调用运维接口；交互模式让你在浏览器里操作后粘贴任务 ID。"""
    if ctx["op_headers"] is not None:
        status, body = http(ctx["base"], "POST", "/operator/tasks", {
            "subject": ctx["agent_subject"], "text": text, "action": action, "webhookId": "wh-a-1",
        }, headers=ctx["op_headers"])
        task_id = (parse_json(body) or {}).get("id", "")
        if not task_id:
            print(f"  运维接口返回 HTTP {status}：{body[:200]}")
        return task_id
    label = "只查看（Inspect only）" if action == "inspect" else "停用 webhook（Disable webhook）"
    print(f"  请在浏览器打开 {ctx['base']}/operator 并登录：")
    print(f"    Agent subject = {ctx['agent_subject']}")
    print(f"    Permitted action = {label}，Exact webhook = wh-a-1，点击 Create task")
    return input("  粘贴任务 ID：").strip()


def approve(ctx, review_id, task_id):
    """审批一次写操作。API 模式下先核对审批页显示的任务与预期一致，再提交审批。"""
    if ctx["op_headers"] is not None:
        status, body = http(ctx["base"], "GET", f"/operator/reviews/{review_id}",
                            headers=ctx["op_headers"])
        shown = (parse_json(body) or {}).get("trustedTask", {}) or {}
        if shown.get("id") != task_id:
            print(f"  审批页显示的任务与预期不一致（HTTP {status}）：{body[:200]}")
            return ""
        status, body = http(ctx["base"], "POST", "/operator/approvals",
                            {"reviewId": review_id}, headers=ctx["op_headers"])
        approval_id = (parse_json(body) or {}).get("id", "")
        if not approval_id:
            print(f"  审批接口返回 HTTP {status}：{body[:200]}")
        return approval_id
    print(f"  请在 {ctx['base']}/operator 上：Review ID = {review_id}")
    print("    点击 Load review，勾选确认框，点击 Approve。审批 2 分钟内有效，请尽快粘贴。")
    return input("  粘贴审批 ID：").strip()


def disable_args(task_id, approval_id=None):
    args = {"taskId": task_id, "webhookId": "wh-a-1", "ticket": TICKET}
    if approval_id:
        args["approvalId"] = approval_id
    return args


# ---------- 主流程 ----------
def main():
    parser = argparse.ArgumentParser(description="分步测试扩展部署")
    parser.add_argument("--local", action="store_true", help="测试本地 pnpm native:dev（端口 8788）")
    parser.add_argument("--host", default=os.environ.get("CF_HOST"), help="部署的域名，例如 agent.example.com")
    args = parser.parse_args()

    if args.local:
        base = os.environ.get("NATIVE_BASE_URL", "http://127.0.0.1:8788")
        agent_headers = {"Authorization": "Bearer demo-a-write"}
        op_headers = {"Authorization": "Bearer demo-operator-a"}
        agent_subject = "partner-one-writer"
        mode = "local"
    else:
        if not args.host:
            sys.exit("请设置 CF_HOST 环境变量或使用 --host，或加 --local 进行本地测试")
        agent_id = os.environ.get("AGENT_CLIENT_ID")
        agent_secret = os.environ.get("AGENT_CLIENT_SECRET")
        if not agent_id or not agent_secret:
            sys.exit("请设置 AGENT_CLIENT_ID 和 AGENT_CLIENT_SECRET（Agent 的服务令牌）")
        base = f"https://{args.host}"
        agent_headers = {"CF-Access-Client-Id": agent_id, "CF-Access-Client-Secret": agent_secret}
        agent_subject = f"service:{agent_id}"
        op_id = os.environ.get("OPERATOR_CLIENT_ID")
        op_secret = os.environ.get("OPERATOR_CLIENT_SECRET")
        op_headers = (
            {"CF-Access-Client-Id": op_id, "CF-Access-Client-Secret": op_secret}
            if op_id and op_secret else None
        )
        mode = "cloud"

    # 运维人员使用 API 还是浏览器：只有本地模式或提供了运维凭证时才自动调用 API
    ctx = {"base": base, "agent_subject": agent_subject, "op_headers": op_headers}
    print(f"目标：{base}  模式：{mode}  运维方式：{'API 自动' if op_headers else '浏览器手动'}  "
          f"Agent 身份：{agent_subject}")

    # 1. 匿名请求应被 Access 拦截 ------------------------------------------------
    step(1, "匿名请求被 Access 拦截：确认 Worker 没有对公网直接开放")
    if mode == "local":
        skip("本地模式没有 Access")
    else:
        status, _ = http(base, "GET", "/health", follow=False)
        if status == 0:
            bad("无法连接域名，请检查 DNS 和自定义域名路由")
            return finish()
        if status == 200:
            bad("未带凭证就返回 200：Worker 公网可直接访问，需要配置 Access 应用")
        elif status in (302, 401, 403):
            ok(f"未带凭证时返回 HTTP {status}（登录跳转或拒绝；仍须核对 Access 配置）")
        else:
            bad(f"HTTP {status} 不能证明 Access 控制有效")

    # 2. Agent 能到达 Worker ----------------------------------------------------
    step(2, "Agent 能到达 Worker：带服务令牌访问健康检查")
    status, body = http(base, "GET", "/health", headers=agent_headers)
    expected = "fixture" if mode == "local" else "cloudflare"
    if status == 200 and (parse_json(body) or {}).get("mode") == expected:
        ok(f"HTTP 200，mode={expected}")
    else:
        bad(f"HTTP {status}：{body[:200]}")
        if status == 503:
            hint("Worker 配置不完整：检查 APP_HOST、ACCESS_TEAM_DOMAIN、ACCESS_AUD 和 IDENTITY_POLICY_JSON")
        elif status in (302, 401, 403):
            hint("Access 没有接受该服务令牌：为它添加 Service Auth 策略")
        return finish()

    # 3. 只能读取本租户的数据 ---------------------------------------------------
    step(3, "只读取本租户的数据：只应看到 wh-a-1，看不到 wh-b-1")
    kind, text = mcp_call(base, agent_headers, "list_integrations", {})
    if kind == "OK" and "wh-a-1" in text and "wh-b-1" not in text:
        ok("只能看到 wh-a-1")
    else:
        bad(f"{kind}：{text[:200]}")
        hint(f"身份策略中缺少 \"{agent_subject}\"（role=agent，tenantId=tenant-a）")
        return finish()
    before = webhook_state(base, agent_headers)
    print(f"           wh-a-1 当前状态：{before}")

    # 4. Agent 不能调用运维接口 -------------------------------------------------
    step(4, "Agent 不能调用运维接口：Agent 身份创建任务应返回 403")
    status, _ = http(base, "POST", "/operator/tasks", {}, headers=agent_headers)
    ok("HTTP 403") if status == 403 else bad(f"期望 403，实际 HTTP {status}")

    # 5. 跨租户写入被拒绝 -------------------------------------------------------
    step(5, "跨租户写入被拒绝：去停用 tenant-b 的 wh-b-1")
    kind, text = mcp_call(base, agent_headers, "disable_webhook",
                          {"taskId": str(uuid.uuid4()), "webhookId": "wh-b-1", "ticket": TICKET})
    if kind == "TOOL_ERROR" and "Action not permitted" in text:
        ok("已拒绝：Action not permitted")
    else:
        bad(f"期望 'Action not permitted'，实际 {kind}：{text[:200]}")

    # 6. 只读任务不能用于写入 ---------------------------------------------------
    step(6, "只读任务不能用于写入：用 inspect 任务去停用 wh-a-1")
    inspect_task = create_task(ctx, "inspect", "Inspect wh-a-1 only. Do not change it.")
    if not inspect_task:
        bad("无法创建只读任务")
        hint("运维身份需要在身份策略中设为 role=operator")
    else:
        kind, text = mcp_call(base, agent_headers, "disable_webhook", disable_args(inspect_task))
        if kind == "TOOL_ERROR" and "Outside trusted task scope" in text:
            ok("已拒绝：Outside trusted task scope")
        else:
            bad(f"期望 'Outside trusted task scope'，实际 {kind}：{text[:200]}")

    # 7. 写操作暂停，等待人工审批 -----------------------------------------------
    step(7, "写操作暂停等待审批：用 disable 任务发起停用")
    task = create_task(ctx, "disable_webhook", "Disable wh-a-1 after inspection.")
    review_id = ""
    if not task:
        bad("无法创建停用任务")
    else:
        kind, text = mcp_call(base, agent_headers, "disable_webhook", disable_args(task))
        payload = parse_json(text) or {}
        status_value = payload.get("status")
        if status_value == "approval_required":
            review_id = payload.get("reviewId", "")
            if webhook_state(base, agent_headers) == before:
                ok("需要审批，webhook 未改变")
            else:
                bad("审批前 webhook 已改变")
        elif status_value in ("review_required", "blocked"):
            # 模型没有判定为 aligned：系统安全地暂停了，但无法继续审批流程
            warn(f"模型判定为 {status_value}（{payload.get('reason')}），未执行任何写入")
            hint("系统安全地暂停；审批流程需要模型判定为 aligned，换一个与任务更贴近的工单文字再试")
        else:
            bad(f"意外结果 {kind}：{text[:200]}")

    # 8. 运维人员审批 -----------------------------------------------------------
    step(8, "运维人员审批具体动作")
    approval_id = ""
    if not review_id:
        skip("没有待审批的请求（见第 7 步）")
    else:
        approval_id = approve(ctx, review_id, task)
        ok(f"已签发审批：{approval_id}") if approval_id else bad("没有拿到审批 ID")

    # 9. 获批后执行一次 ---------------------------------------------------------
    step(9, "获批后执行一次：带上审批 ID 再次调用")
    if not approval_id:
        skip("没有审批（见第 8 步）")
    else:
        kind, text = mcp_call(base, agent_headers, "disable_webhook",
                              disable_args(task, approval_id))
        after = webhook_state(base, agent_headers)
        if (parse_json(text) or {}).get("status") == "executed" and after.startswith("enabled=False"):
            ok(f"已执行；wh-a-1 现在 {after}")
        else:
            bad(f"期望 executed，实际 {kind}：{text[:200]}，状态 {after}")
            if "expired" in text:
                hint("审批 2 分钟内有效，请重新运行并更快粘贴")

    # 10. 重复使用审批被拒绝 ----------------------------------------------------
    step(10, "重复使用审批被拒绝：同一个审批 ID 再用一次")
    if not approval_id:
        skip("没有审批（见第 8 步）")
    else:
        kind, text = mcp_call(base, agent_headers, "disable_webhook",
                              disable_args(task, approval_id))
        if kind == "TOOL_ERROR" and "consumed" in text:
            ok("已拒绝：审批已被使用")
        else:
            bad(f"期望 consumed 错误，实际 {kind}：{text[:200]}")

    return finish()


def finish():
    r = results
    print(f"\n总结：{r['pass']} 通过，{r['fail']} 失败，{r['warn']} 警告，{r['skip']} 跳过")
    return 0 if r["fail"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

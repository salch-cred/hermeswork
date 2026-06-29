"""
HermesWork v12.0.0 — Comprehensive Test Suite
Tests all endpoints, utilities, and edge cases.
Run: python3 test_suite.py
"""
import asyncio
import json
import time
import threading
import httpx
import sys
import os

# Ensure we can import from the backend
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

passed = 0
failed = 0
errors = []

def test(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        errors.append(f"{name}: {detail}")
        print(f"  ❌ {name} — {detail}")

# ═══════════════════════════════════════════════════════════════════════════════
# UNIT TESTS — Utility Functions
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("UNIT TESTS — Utility Functions")
print("=" * 70)

from utils import (
    safe_string, is_valid_date_string, today, make_invoice_id,
    timing_safe_equal_string, get_rate_bucket, thompson_win_prob,
    empty_db, normalize_db,
)

# safe_string
test("safe_string strips HTML", "<script>alert(1)</script>" not in safe_string("<script>alert(1)</script>"))
test("safe_string truncates", len(safe_string("A" * 1000, 50)) == 50)
test("safe_string handles None", safe_string(None) == "")
test("safe_string handles empty", safe_string("") == "")

# is_valid_date_string
test("valid date 2026-07-15", is_valid_date_string("2026-07-15"))
test("invalid date 2026-13-01", not is_valid_date_string("2026-13-01"))
test("invalid date format", not is_valid_date_string("July 15, 2026"))
test("invalid date empty", not is_valid_date_string(""))

# today
t = today()
test("today returns YYYY-MM-DD", len(t) == 10 and t[4] == "-" and t[7] == "-")

# make_invoice_id
db = empty_db()
test("first invoice ID", make_invoice_id(db) == "INV-001")
db["invoices"].append({"id": "INV-001"})
test("second invoice ID", make_invoice_id(db) == "INV-002")
db["invoices"].append({"id": "INV-005"})
test("next after gap", make_invoice_id(db) == "INV-006")

# timing_safe_equal_string
test("equal strings", timing_safe_equal_string("abc", "abc"))
test("unequal strings", not timing_safe_equal_string("abc", "def"))
test("empty strings", not timing_safe_equal_string("", ""))
test("None handling", not timing_safe_equal_string(None, "abc"))

# get_rate_bucket
test("rate 25 → 25-50", get_rate_bucket(25) == "25-50")
test("rate 50 → 50-75", get_rate_bucket(50) == "50-75")
test("rate 75 → 75-100", get_rate_bucket(75) == "75-100")
test("rate 100 → 100-150", get_rate_bucket(100) == "100-150")
test("rate 150 → 150-200", get_rate_bucket(150) == "150-200")
test("rate 200 → 200+", get_rate_bucket(200) == "200+")
test("rate 300 → 200+", get_rate_bucket(300) == "200+")

# thompson_win_prob
test("default bucket 50%", abs(thompson_win_prob("25-50", {}) - 0.5) < 0.01)
test("all wins high prob", thompson_win_prob("25-50", {"25-50": {"alpha": 10, "beta": 1}}) > 0.8)
test("all losses low prob", thompson_win_prob("25-50", {"25-50": {"alpha": 1, "beta": 10}}) < 0.2)

# empty_db / normalize_db
edb = empty_db()
test("empty_db has invoices", "invoices" in edb and isinstance(edb["invoices"], list))
test("empty_db has clients", "clients" in edb)
test("empty_db has proposals", "proposals" in edb)
test("empty_db has reputation", "reputation" in edb)
test("empty_db has payments", "payments" in edb)
test("empty_db has activities", "activities" in edb)

ndb = normalize_db({"invoices": "not a list"})
test("normalize_db fixes bad list", ndb["invoices"] == [])
ndb = normalize_db({"invoices": [1, 2], "extra": "ignored"})
test("normalize_db keeps good list", ndb["invoices"] == [1, 2])

# ═══════════════════════════════════════════════════════════════════════════════
# INTEGRATION TESTS — HTTP Endpoints
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("INTEGRATION TESTS — HTTP Endpoints")
print("=" * 70)

import uvicorn

def run_server():
    uvicorn.run("app:app", host="127.0.0.1", port=3998, log_level="error")

# Clean data
if os.path.exists("data.json"):
    os.remove("data.json")

server_thread = threading.Thread(target=run_server, daemon=True)
server_thread.start()
time.sleep(3)

async def run_http_tests():
    global passed, failed
    async with httpx.AsyncClient(base_url="http://127.0.0.1:3998", timeout=10) as c:
        # ── Health ─────────────────────────────────────────────────────────────
        r = await c.get("/health")
        d = r.json()
        test("GET /health returns 200", r.status_code == 200)
        test("health status ok", d.get("status") == "ok")
        test("health version v12.0.0", d.get("version") == "v12.0.0")
        test("health agents 41", d.get("agents") == 41)
        test("health mcpTools >= 60", d.get("mcpTools", 0) >= 60)
        test("health researchPapers 41", d.get("researchPapers") == 41)

        # ── Agents ─────────────────────────────────────────────────────────────
        r = await c.get("/agents")
        d = r.json()
        test("GET /agents returns 200", r.status_code == 200)
        test("agents total 41", d.get("total") == 41)
        test("agents is list", isinstance(d.get("agents"), list))

        # ── MCP Manifest ───────────────────────────────────────────────────────
        r = await c.get("/mcp/manifest")
        d = r.json()
        test("GET /mcp/manifest returns 200", r.status_code == 200)
        test("manifest has tools array", isinstance(d.get("tools"), list))
        test("manifest tools >= 60", len(d.get("tools", [])) >= 60)
        test("manifest has auth", "auth" in d)

        # ── Dashboard ──────────────────────────────────────────────────────────
        r = await c.get("/dashboard/live")
        d = r.json()
        test("GET /dashboard/live returns 200", r.status_code == 200)
        test("dashboard totalRevenue >= 0", d.get("totalRevenue", -1) >= 0)
        test("dashboard winRate >= 0", d.get("winRate", -1) >= 0)
        test("dashboard outstandingValue >= 0", d.get("outstandingValue", -1) >= 0)
        test("dashboard overdueValue >= 0", d.get("overdueValue", -1) >= 0)
        test("dashboard mrr >= 0", d.get("mrr", -1) >= 0)
        test("dashboard has monthlyRevenue", isinstance(d.get("monthlyRevenue"), list))

        # ── Benchmark ──────────────────────────────────────────────────────────
        r = await c.get("/benchmark")
        d = r.json()
        test("GET /benchmark returns 200", r.status_code == 200)
        test("benchmark has scores", "scores" in d)
        test("benchmark overall > 0", d.get("scores", {}).get("overall", 0) > 0)
        test("benchmark has features list", isinstance(d.get("features"), list))
        test("benchmark agentCount 41", d.get("agentCount") == 41)

        # ── Agent Card (A2A) ───────────────────────────────────────────────────
        r = await c.get("/.well-known/agent.json")
        d = r.json()
        test("GET /.well-known/agent.json returns 200", r.status_code == 200)
        test("agent card has name", "name" in d)
        test("agent card version v12.0.0", d.get("version") == "v12.0.0")
        test("agent card has capabilities", "capabilities" in d)

        # ── MPP ────────────────────────────────────────────────────────────────
        r = await c.get("/.well-known/mpp.json")
        d = r.json()
        test("GET /.well-known/mpp.json returns 200", r.status_code == 200)
        test("mpp has payment_methods", "payment_methods" in d)

        # ── W3C VC ─────────────────────────────────────────────────────────────
        r = await c.get("/reputation/vc")
        d = r.json()
        test("GET /reputation/vc returns 200", r.status_code == 200)
        test("vc has @context", "@context" in d)
        test("vc has credentialSubject", "credentialSubject" in d)
        test("vc has proof", "proof" in d)

        # ── Profile ────────────────────────────────────────────────────────────
        r = await c.get("/profile/salman")
        d = r.json()
        test("GET /profile/salman returns 200", r.status_code == 200)
        test("profile handle salman", d.get("handle") == "salman")
        test("profile has badges", isinstance(d.get("badges"), list))

        # ── Create Invoice ─────────────────────────────────────────────────────
        r = await c.post("/invoices", json={"client": "Acme Corp", "amount": 5000, "dueDate": "2026-07-30"})
        d = r.json()
        test("POST /invoices returns 201", r.status_code == 201)
        test("invoice success", d.get("success") == True)
        test("invoice has ID", "id" in d.get("invoice", {}))

        # ── Create Invoice with invalid date ───────────────────────────────────
        r = await c.post("/invoices", json={"client": "Bad", "amount": 100, "dueDate": "invalid"})
        test("POST /invoices invalid date fails", r.status_code in (400, 422, 500))

        # ── List Invoices ──────────────────────────────────────────────────────
        r = await c.get("/invoices")
        d = r.json()
        test("GET /invoices returns 200", r.status_code == 200)
        test("invoices total >= 1", d.get("total", 0) >= 1)

        # ── Get Single Invoice ─────────────────────────────────────────────────
        inv_id = d["invoices"][0]["id"] if d.get("invoices") else "INV-001"
        r = await c.get(f"/invoices/{inv_id}")
        test("GET /invoices/{id} returns 200", r.status_code == 200)

        # ── Create Client ──────────────────────────────────────────────────────
        r = await c.post("/clients", json={"name": "Test Client", "email": "test@test.com"})
        d = r.json()
        test("POST /clients returns 201", r.status_code == 201)
        test("client success", d.get("success") == True)

        # ── List Clients ───────────────────────────────────────────────────────
        r = await c.get("/clients")
        d = r.json()
        test("GET /clients returns 200", r.status_code == 200)
        test("clients total >= 1", d.get("total", 0) >= 1)

        # ── Create Proposal ────────────────────────────────────────────────────
        r = await c.post("/proposals", json={"title": "Web Redesign", "client": "Test Client", "amount": 8000})
        d = r.json()
        test("POST /proposals returns 201", r.status_code == 201)
        test("proposal success", d.get("success") == True)

        # ── List Proposals ─────────────────────────────────────────────────────
        r = await c.get("/proposals")
        d = r.json()
        test("GET /proposals returns 200", r.status_code == 200)
        test("proposals total >= 1", d.get("total", 0) >= 1)

        # ── Activities ─────────────────────────────────────────────────────────
        r = await c.get("/activities")
        d = r.json()
        test("GET /activities returns 200", r.status_code == 200)
        test("activities is list", isinstance(d.get("activities"), list))

        # ── Analytics ──────────────────────────────────────────────────────────
        r = await c.get("/analytics")
        d = r.json()
        test("GET /analytics returns 200", r.status_code == 200)
        test("analytics has kpis", "kpis" in d)

        # ── v12 Agents ─────────────────────────────────────────────────────────
        r = await c.get("/v12/agents")
        d = r.json()
        test("GET /v12/agents returns 200", r.status_code == 200)
        test("v12 agents >= 5", d.get("total", 0) >= 5)

        # ── v11 Agents ─────────────────────────────────────────────────────────
        r = await c.get("/v11/agents")
        d = r.json()
        test("GET /v11/agents returns 200", r.status_code == 200)

        # ── Skills Export ──────────────────────────────────────────────────────
        r = await c.get("/skills/export")
        test("GET /skills/export returns 200", r.status_code == 200)
        test("skills export has content", len(r.text) > 100)

        # ── Skills History ─────────────────────────────────────────────────────
        r = await c.get("/skills/history")
        test("GET /skills/history returns 200", r.status_code == 200)

        # ── WhatsApp Status ────────────────────────────────────────────────────
        r = await c.get("/whatsapp/status")
        test("GET /whatsapp/status returns 200", r.status_code == 200)

        # ── Root ───────────────────────────────────────────────────────────────
        r = await c.get("/")
        d = r.json()
        test("GET / returns 200", r.status_code == 200)
        test("root has agents 41", d.get("agents") == 41)

        # ── MCP Execute ────────────────────────────────────────────────────────
        r = await c.post("/mcp/execute", json={"tool": "get_kpis", "args": {}})
        d = r.json()
        test("POST /mcp/execute get_kpis", "totalRevenue" in d)

        # ── Demo Seed ──────────────────────────────────────────────────────────
        r = await c.post("/demo/seed")
        d = r.json()
        test("POST /demo/seed returns 200", r.status_code == 200)
        test("demo seed success", d.get("success") == True)

        # ── KPIs after seed (should be positive, not negative) ─────────────────
        r = await c.get("/dashboard/live")
        d = r.json()
        test("KPIs after seed: revenue >= 0", d.get("totalRevenue", -1) >= 0)
        test("KPIs after seed: winRate >= 0", d.get("winRate", -1) >= 0)
        test("KPIs after seed: outstanding >= 0", d.get("outstandingValue", -1) >= 0)
        test("KPIs after seed: clients >= 1", d.get("clients", 0) >= 1)

        # ── Payment Confirm ────────────────────────────────────────────────────
        r = await c.post("/pay/INV-001/confirm", json={"txHash": "0xabc123"})
        d = r.json()
        test("POST /pay/confirm returns 200", r.status_code == 200)
        test("payment confirm success", d.get("success") == True)
        test("payment minted credential", "credential" in d)

        # ── Performance benchmarks ─────────────────────────────────────────────
        t0 = time.perf_counter()
        await c.get("/health")
        health_ms = (time.perf_counter() - t0) * 1000
        test("health response < 100ms", health_ms < 100, f"{health_ms:.1f}ms")

        t0 = time.perf_counter()
        await c.get("/dashboard/live")
        dash_ms = (time.perf_counter() - t0) * 1000
        test("dashboard response < 200ms", dash_ms < 200, f"{dash_ms:.1f}ms")

        t0 = time.perf_counter()
        await c.get("/mcp/manifest")
        manifest_ms = (time.perf_counter() - t0) * 1000
        test("manifest response < 100ms", manifest_ms < 100, f"{manifest_ms:.1f}ms")

asyncio.run(run_http_tests())

# ═══════════════════════════════════════════════════════════════════════════════
# EDGE CASE TESTS
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print("EDGE CASE TESTS")
print("=" * 70)

async def run_edge_tests():
    async with httpx.AsyncClient(base_url="http://127.0.0.1:3998", timeout=10) as c:
        # Empty database KPIs
        if os.path.exists("data.json"):
            os.remove("data.json")
        # Need to restart to reload db... just test via direct calls
        from app import build_kpis
        import app as app_module
        app_module.db = empty_db()
        k = build_kpis()
        test("empty db: revenue 0", k["totalRevenue"] == 0)
        test("empty db: winRate 0", k["winRate"] == 0)
        test("empty db: outstanding 0", k["outstandingValue"] == 0)
        test("empty db: overdue 0", k["overdueValue"] == 0)
        test("empty db: clients 0", k["clients"] == 0)

        # Invoice with amount 0
        app_module.db = empty_db()
        from app import execute_mcp_tool
        r = await execute_mcp_tool("create_invoice", {"client": "Zero", "amount": 0, "dueDate": "2026-07-15"}, True)
        test("invoice with amount 0", r["invoice"]["amount"] == 0)
        k = build_kpis()
        test("KPIs with 0 amount: revenue 0", k["totalRevenue"] == 0)

        # XSS in client name
        r = await execute_mcp_tool("add_client", {"name": "<script>alert('xss')</script>"}, True)
        test("XSS filtered in client name", "<script>" not in r["client"]["name"])

        # Long string truncation
        r = await execute_mcp_tool("add_client", {"name": "A" * 500}, True)
        test("long name truncated", len(r["client"]["name"]) <= 100)

asyncio.run(run_edge_tests())

# ═══════════════════════════════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "=" * 70)
print(f"TEST RESULTS: {passed} passed, {failed} failed, {passed + failed} total")
print("=" * 70)

if failed > 0:
    print("\nFAILURES:")
    for e in errors:
        print(f"  ❌ {e}")
    sys.exit(1)
else:
    print("\n🎉 ALL TESTS PASSED!")
    sys.exit(0)
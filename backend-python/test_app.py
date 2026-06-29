"""
HermesWork v12 — Python backend test suite
===========================================
Run:  pytest test_app.py -v
  or: python -m pytest test_app.py

Covers: utility units, KPI bug-fix edge cases, and API integration via
FastAPI TestClient (no external server needed).
"""
import os
import importlib

import pytest
from fastapi.testclient import TestClient

# Ensure a clean, isolated data file for tests
os.environ.setdefault("NODE_ENV", "development")

import config as cfg  # noqa: E402
import utils  # noqa: E402
import app as appmod  # noqa: E402

client = TestClient(appmod.app)


# ════════════════════════════════════════════════════════════════════
# Unit tests — utilities
# ════════════════════════════════════════════════════════════════════
def test_sanitize_env_url():
    assert cfg.sanitize_env_url('  "https://x.io"  ') == "https://x.io"
    assert cfg.sanitize_env_url("FOO=https://y.io") == "https://y.io"
    assert cfg.sanitize_env_url("") == ""


def test_safe_string_truncates_and_escapes():
    assert utils.safe_string("a" * 1000, 10) == "a" * 10
    out = utils.safe_string("<script>alert(1)</script>")
    assert "<script>" not in out
    assert utils.safe_string(None) == ""


def test_is_valid_date_string():
    assert utils.is_valid_date_string("2026-07-15") is True
    assert utils.is_valid_date_string("2026-13-99") is False
    assert utils.is_valid_date_string("07/15/2026") is False
    assert utils.is_valid_date_string("garbage") is False


def test_today_format():
    t = utils.today()
    assert len(t) == 10 and t[4] == "-" and t[7] == "-"


def test_make_invoice_id_sequential():
    db = {"invoices": [{"id": "INV-001"}, {"id": "INV-002"}]}
    assert utils.make_invoice_id(db) == "INV-003"
    assert utils.make_invoice_id({"invoices": []}) == "INV-001"


def test_timing_safe_equal():
    assert utils.timing_safe_equal_string("secret", "secret") is True
    assert utils.timing_safe_equal_string("secret", "Secret") is False
    assert utils.timing_safe_equal_string("", "x") is False


def test_rate_bucket():
    assert utils.get_rate_bucket(30) == "25-50"
    assert utils.get_rate_bucket(250) == "200+"
    assert utils.get_rate_bucket(120) == "100-150"


def test_thompson_and_best_bucket():
    bandits = {"100-150": {"alpha": 9, "beta": 1}, "25-50": {"alpha": 1, "beta": 9}}
    assert utils.thompson_win_prob("100-150", bandits) > utils.thompson_win_prob("25-50", bandits)
    assert utils.get_best_rate_bucket(bandits) == "100-150"


def test_empty_and_normalize_db():
    e = utils.empty_db()
    for k in ("invoices", "clients", "proposals", "reputation"):
        assert k in e and e[k] == []
    n = utils.normalize_db({"invoices": "not-a-list", "extra": 1})
    assert isinstance(n["invoices"], list)


# ════════════════════════════════════════════════════════════════════
# KPI bug-fix — the critical regression tests (never negative)
# ════════════════════════════════════════════════════════════════════
def test_kpis_empty_db_all_zero():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    k = appmod.build_kpis()
    for key, val in k.items():
        if isinstance(val, (int, float)):
            assert val >= 0, f"{key} was negative: {val}"
    assert k["winRate"] == 0
    assert k["totalRevenue"] == 0


def test_kpis_handles_null_and_negative_amounts():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    appmod.db["invoices"] = [
        {"id": "INV-001", "amount": None, "status": "paid"},
        {"id": "INV-002", "amount": -500, "status": "paid"},   # corrupt row
        {"id": "INV-003", "amount": 1000, "status": "paid"},
        {"id": "INV-004", "amount": "bad", "status": "pending"},
    ]
    k = appmod.build_kpis()
    assert k["totalRevenue"] == 1000  # null/negative/bad clamped to 0
    assert k["outstandingValue"] >= 0
    assert k["winRate"] == 0


def test_kpis_win_rate_clamped():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    appmod.db["proposals"] = [
        {"id": "1", "status": "won", "amount": 100},
        {"id": "2", "status": "won", "amount": 100},
        {"id": "3", "status": "lost", "amount": 100},
    ]
    k = appmod.build_kpis()
    assert 0 <= k["winRate"] <= 100
    assert k["winRate"] == 67


# ════════════════════════════════════════════════════════════════════
# Integration tests — API endpoints
# ════════════════════════════════════════════════════════════════════
def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    assert d["version"] == cfg.VERSION
    assert d["agents"] >= 36
    assert d["mcpTools"] >= 36


def test_agents():
    r = client.get("/agents")
    assert r.status_code == 200
    assert "agents" in r.json()


def test_mcp_manifest():
    r = client.get("/mcp/manifest")
    assert r.status_code == 200
    d = r.json()
    assert isinstance(d["tools"], list)
    assert len(d["tools"]) >= 10


def test_dashboard_live_non_negative():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    r = client.get("/dashboard/live")
    assert r.status_code == 200
    for key, val in r.json().items():
        if isinstance(val, (int, float)):
            assert val >= 0


def test_well_known_agent_card():
    r = client.get("/.well-known/agent.json")
    assert r.status_code == 200
    d = r.json()
    assert "HermesWork" in d["name"]
    assert isinstance(d["skills"], list) and len(d["skills"]) > 0


def test_well_known_mpp():
    r = client.get("/.well-known/mpp.json")
    assert r.status_code == 200
    d = r.json()
    assert "payment_methods" in d


def test_reputation_vc():
    r = client.get("/reputation/vc")
    assert r.status_code == 200
    assert "VerifiableCredential" in r.json()["type"]


def test_benchmark():
    r = client.get("/benchmark")
    assert r.status_code == 200
    d = r.json()
    assert d["agentCount"] >= 36
    assert d["researchPapers"] >= 36
    assert isinstance(d["scores"], dict) and len(d["scores"]) > 0


def test_invoice_crud_flow():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    # create
    r = client.post("/invoices", json={"client": "Acme", "amount": 4800,
                                       "dueDate": "2026-07-15", "paymentMethod": "x402"})
    assert r.status_code == 201
    inv_id = r.json()["invoice"]["id"]
    # list
    r = client.get("/invoices")
    assert r.json()["total"] == 1
    # mark paid via MCP tool
    r = client.post("/mcp/execute", json={"tool": "mark_invoice_paid", "args": {"id": inv_id}})
    assert r.status_code == 200
    # KPIs reflect revenue
    k = client.get("/dashboard/live").json()
    assert k["totalRevenue"] == 4800


def test_invoice_validation_error():
    r = client.post("/invoices", json={"client": "Acme"})  # missing amount/dueDate
    assert r.status_code == 422


def test_invoice_bad_date():
    r = client.post("/invoices", json={"client": "Acme", "amount": 10, "dueDate": "bad"})
    assert r.status_code == 422


def test_client_crud():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    r = client.post("/clients", json={"name": "Dune Media", "email": "x@dune.io"})
    assert r.status_code == 201
    assert client.get("/clients").json()["total"] == 1


def test_proposal_and_outcome():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    r = client.post("/proposals", json={"title": "Brand refresh", "client": "Dune", "amount": 3600})
    assert r.status_code == 201
    pid = r.json()["proposal"]["id"]
    r = client.post(f"/proposals/{pid}/outcome", json={"status": "won"})
    assert r.status_code == 200


def test_mcp_execute_unknown_tool():
    r = client.post("/mcp/execute", json={"tool": "does_not_exist", "arguments": {}})
    assert r.status_code in (400, 404)


def test_xss_sanitized_in_client_name():
    appmod.db.clear()
    appmod.db.update(utils.empty_db())
    r = client.post("/clients", json={"name": "<script>alert(1)</script>Bob"})
    assert r.status_code == 201
    assert "<script>" not in r.json()["client"]["name"]


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))

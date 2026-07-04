#!/usr/bin/env bash
# Simple MCP stdio smoke test.
# Spawns the built server with a prepared JSON-RPC stdin payload and prints
# all responses. Exits non-zero on transport/server errors.

set -euo pipefail

cd "$(dirname "$0")/.."

payload="82
{\"jsonrpc\":\"2.0\",\"id\":0,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"1.0.0\"}}}
38
{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\",\"params\":{}}
65
{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\",\"params\":{}}
108
{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"get_provider_quota\",\"arguments\":{\"provider\":\"kimi\",\"mock\":true}}}
60
{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"get_quota_summary\",\"arguments\":{}}}
62
{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"check_quota_health\",\"arguments\":{}}}
"

echo "$payload" | timeout 10 node dist/index.js

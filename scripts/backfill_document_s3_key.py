#!/usr/bin/env python3
"""Backfill the ``s3Key`` property onto every Neo4j ``Document`` node.

The agent download tool (``tools/document_download.py``) historically resolved a
``doc_id`` to its S3 source key ONLY through the committed metadata parquet
snapshot. That snapshot can drift from the live graph in a deployed image. This
backfill writes the source key directly onto each ``Document`` node so the tool
can resolve it from the live graph (drift-proof), keeping the parquet only as a
fallback.

Mapping: ``Document.id`` == parquet ``file_identifier``. For chunk nodes
(``id = {parent}__chunk_N``) the parent fid is the parquet key, so we strip the
chunk suffix before the lookup and set ``s3Key`` on the chunk node itself (the
parent does NOT exist as its own node).

Resume-safe: only nodes missing ``s3Key`` are processed (unless ``--rebuild``),
and a cursor is persisted to ``logs/backfill_document_s3_key_state.json``.
Idempotent. Read-only on the parquet; the only write is ``SET d.s3Key``.

Usage:
    uv run python scripts/backfill_document_s3_key.py            # full backfill
    uv run python scripts/backfill_document_s3_key.py --limit 200 --dry-run
    uv run python scripts/backfill_document_s3_key.py --rebuild  # overwrite all
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))
try:
    from dotenv import load_dotenv

    load_dotenv(_ROOT / ".env", override=True)
except Exception:
    pass

import pandas as pd  # noqa: E402

from Neo4j.connection.conn import Neo4jConnection  # noqa: E402
from s3pdf_manager.download_pdf import PARQUET_PATH  # noqa: E402

_CHUNK_SEP = "__chunk_"
_STATE_PATH = _ROOT / "logs" / "backfill_document_s3_key_state.json"

# Read a batch of node ids, advancing a monotonic id cursor. The skip-existing
# filter ($rebuild OR d.s3Key IS NULL) makes a fresh run idempotent.
_READ_QUERY = """
MATCH (d:Document)
WHERE d.id > $cursor AND ($rebuild OR d.s3Key IS NULL)
RETURN d.id AS id
ORDER BY d.id
LIMIT $batch
"""

_WRITE_QUERY = """
UNWIND $rows AS row
MATCH (d:Document {id: row.id})
SET d.s3Key = row.s3_key
"""


def _parent_fid(doc_id: str) -> str:
    return str(doc_id).split(_CHUNK_SEP, 1)[0].strip()


def _load_parquet_keys() -> dict[str, str]:
    """Return {file_identifier: s3_key} from the metadata parquet (NaN dropped)."""
    path = _ROOT / PARQUET_PATH
    df = pd.read_parquet(path, columns=["s3_key"])
    if df.index.name != "file_identifier":
        if "file_identifier" in df.columns:
            df = df.set_index("file_identifier")
        else:
            raise SystemExit(f"parquet {path} has no file_identifier index/column")
    s = df["s3_key"]
    s = s[s.notna()]
    return {str(k): str(v) for k, v in s.items() if str(v).strip()}


def _load_state() -> dict:
    if _STATE_PATH.exists():
        try:
            return json.loads(_STATE_PATH.read_text())
        except Exception:
            pass
    return {"cursor": "", "set": 0, "no_match": 0, "scanned": 0}


def _save_state(state: dict) -> None:
    _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    _STATE_PATH.write_text(json.dumps(state, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill Document.s3Key from the metadata parquet.")
    ap.add_argument("--batch", type=int, default=5000, help="Read/write batch size (default 5000).")
    ap.add_argument("--limit", type=int, default=0, help="Stop after N nodes scanned (0 = all).")
    ap.add_argument("--rebuild", action="store_true", help="Overwrite s3Key even if already set.")
    ap.add_argument("--restart", action="store_true", help="Ignore saved cursor; start from scratch.")
    ap.add_argument("--dry-run", action="store_true", help="Resolve keys but do not write to Neo4j.")
    args = ap.parse_args()

    print(f"[backfill] loading parquet keys from {PARQUET_PATH} ...", flush=True)
    keys = _load_parquet_keys()
    print(f"[backfill] parquet file_identifiers with s3_key: {len(keys):,}", flush=True)

    state = {"cursor": "", "set": 0, "no_match": 0, "scanned": 0}
    if not args.rebuild and not args.restart:
        state = _load_state()
        if state.get("cursor"):
            print(f"[backfill] resuming from cursor={state['cursor']!r}", flush=True)

    conn = Neo4jConnection()
    no_match_examples: list[str] = []
    t0 = time.time()
    try:
        while True:
            with conn.session() as s:
                rows = [
                    r["id"]
                    for r in s.run(
                        _READ_QUERY,
                        cursor=state["cursor"],
                        rebuild=bool(args.rebuild),
                        batch=args.batch,
                    )
                ]
            if not rows:
                break

            pairs = []
            for node_id in rows:
                s3_key = keys.get(_parent_fid(node_id))
                if s3_key:
                    pairs.append({"id": node_id, "s3_key": s3_key})
                else:
                    state["no_match"] += 1
                    if len(no_match_examples) < 10:
                        no_match_examples.append(node_id)

            if pairs and not args.dry_run:
                with conn.session() as s:
                    s.run(_WRITE_QUERY, rows=pairs)
            state["set"] += len(pairs)
            state["scanned"] += len(rows)
            state["cursor"] = rows[-1]
            if not args.dry_run:
                _save_state(state)

            rate = state["scanned"] / max(1e-6, time.time() - t0)
            print(
                f"[backfill] scanned={state['scanned']:,} set={state['set']:,} "
                f"no_match={state['no_match']:,} ({rate:,.0f}/s)",
                flush=True,
            )
            if args.limit and state["scanned"] >= args.limit:
                print("[backfill] --limit reached; stopping.", flush=True)
                break
    finally:
        conn.close()

    print(
        f"\n[backfill] DONE — scanned={state['scanned']:,} set={state['set']:,} "
        f"no_match={state['no_match']:,} in {time.time() - t0:,.1f}s"
        + (" (dry-run, no writes)" if args.dry_run else ""),
        flush=True,
    )
    if no_match_examples:
        print(f"[backfill] no-parquet-match examples: {no_match_examples}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python
"""Refresh ``discovery/results/corpus_state.json`` from the LIVE graph.

Why this exists
---------------
``corpus_state.json`` is the bookkeeping snapshot ``tools/graph_schema.py``
reads for ``evaluations/`` and pipeline diagnostics. It is
normally rewritten by ``GraphRebuildPipeline/verify.py::write_corpus_state`` —
but only when a **year's verify gate goes green**. While a year is mid-flight
the snapshot under-reports the corpus, and every prose surface inherits that
staleness silently (observed 2026-08-20: file said 21,098 docs / years [2014]
while the live graph held 42,699 / [2014, 2015]).

This script closes that window. It is **read-only**: every query goes through
``Neo4j.retrievers.cypher_runner.run_cypher``, which rejects write tokens
before the driver sees them and applies a real ``unit_of_work`` timeout.

Usage
-----
    uv run python scripts/refresh_corpus_state.py            # write the file
    uv run python scripts/refresh_corpus_state.py --dry-run  # print, write nothing

Exit codes: 0 ok · 1 graph/query error · 2 nothing ingested yet.

NOTE (2026-09-09): the AGENT no longer renders anything from this file — its
prompt and tool descriptions carry structure only and read inventory live via
``graph_schema_introspect``. The snapshot remains the bookkeeping record for
``evaluations/`` and the rebuild's own gates.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from Neo4j.retrievers.cypher_runner import run_cypher  # noqa: E402

STATE_PATH = _REPO_ROOT / "discovery" / "results" / "corpus_state.json"

# Universe denominators — the parsed-corpus census x parquet cross-join
# (2026-08-17) and the parquet row count. Kept identical to
# GraphRebuildPipeline/verify.py so a refresh here and a year-verify there can
# never disagree.
UNIVERSE_PARSED_DOCS = 494421
UNIVERSE_SOURCE_DOCS = 624894
EMBEDDING_DIM = 4096


def _scalar(query: str, *, timeout_s: float = 300) -> int:
    rows = run_cypher(query, timeout_s=timeout_s)
    if not rows:
        return 0
    return int(next(iter(rows[0].values())) or 0)


def collect() -> dict:
    """Read the live counts. Read-only; no writes reach the driver."""
    docs = _scalar("MATCH (d:Document) RETURN count(d) AS n")
    chunks = _scalar("MATCH (c:Chunk) RETURN count(c) AS n")
    years = [
        int(r["year"])
        for r in run_cypher(
            "MATCH (d:Document) WHERE d.year IS NOT NULL "
            "RETURN DISTINCT d.year AS year ORDER BY year",
            timeout_s=300,
        )
    ]
    return {
        "schema_version": 2,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "git_sha": "refresh-corpus-state",
        "corpus": {
            "documents": docs,
            "chunks": chunks,
            "years_ingested": years,
            # Asserted per-year by GraphRebuildPipeline verify.embeddings_gate
            # (0 null embeddings / 0 wrong dims). Measuring it here would mean
            # reading every 4096-float vector (~130 s+) for no new information.
            "embedding_coverage_pct": 100.0,
            "embedding_dim": EMBEDDING_DIM,
            "universe_parsed_docs": UNIVERSE_PARSED_DOCS,
            "universe_source_docs": UNIVERSE_SOURCE_DOCS,
            "ingest_pct": round(docs / UNIVERSE_PARSED_DOCS * 100, 2) if docs else 0.0,
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--dry-run", action="store_true", help="print the snapshot, write nothing")
    args = ap.parse_args()

    try:
        state = collect()
    except Exception as exc:  # noqa: BLE001 — surface the real cause to the operator
        print(f"ERROR: could not read the live graph: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    c = state["corpus"]
    prev = None
    if STATE_PATH.exists():
        try:
            prev = json.loads(STATE_PATH.read_text(encoding="utf-8")).get("corpus")
        except Exception:  # noqa: BLE001 — a corrupt previous file is not fatal here
            prev = None

    print(f"documents : {c['documents']:,}")
    print(f"chunks    : {c['chunks']:,}")
    print(f"years     : {c['years_ingested'] or 'none'}")
    print(f"ingest    : {c['ingest_pct']}% of {c['universe_parsed_docs']:,} parsed docs")
    if prev:
        d_docs = c["documents"] - int(prev.get("documents", 0))
        d_chunks = c["chunks"] - int(prev.get("chunks", 0))
        print(f"delta vs snapshot on disk: {d_docs:+,} documents, {d_chunks:+,} chunks")

    if not c["documents"]:
        print("refusing to write: the graph reports 0 documents", file=sys.stderr)
        return 2

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")
    print(f"\nwrote {STATE_PATH.relative_to(_REPO_ROOT)}")
    print("restart the agent — agents/schema_facts.py caches these facts per process")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

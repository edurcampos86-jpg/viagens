"""
audit_dates.py — flag trips whose recorded year/month likely doesn't match Google Photos.

For each trip with status="done", query Google Photos in the trip's year-month window
(±1 month buffer). If zero photos are found, the date is suspect. Writes a markdown
report to data/audit-report.md.

Usage (locally with creds in env):
    GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... GOOGLE_REFRESH_TOKEN=... \
        python scripts/audit_dates.py

In GitHub Actions, dispatched via the audit-dates workflow.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from sync import get_credentials, log

REPO_ROOT = Path(__file__).resolve().parent.parent
TRIPS_PATH = REPO_ROOT / "data" / "trips.json"
REPORT_PATH = REPO_ROOT / "data" / "audit-report.md"


def count_photos(service, start: date, end: date) -> int:
    body = {
        "filters": {
            "dateFilter": {
                "ranges": [{
                    "startDate": {"year": start.year, "month": start.month, "day": start.day},
                    "endDate":   {"year": end.year,   "month": end.month,   "day": end.day},
                }]
            },
            "mediaTypeFilter": {"mediaTypes": ["PHOTO"]},
        },
        "pageSize": 100,
    }
    total = 0
    page_token = None
    pages_seen = 0
    try:
        while True:
            if page_token:
                body["pageToken"] = page_token
            resp = service.mediaItems().search(body=body).execute()
            items = resp.get("mediaItems", [])
            total += len(items)
            pages_seen += 1
            page_token = resp.get("nextPageToken")
            if not page_token or pages_seen >= 5:
                break
    except HttpError as e:
        log(f"  Photos error {start}..{end}: {e}")
        return -1
    return total


def window_for(year: int, month: int) -> tuple[date, date]:
    """Recorded month ±1 month buffer."""
    if month == 1:
        start = date(year - 1, 12, 1)
    else:
        start = date(year, month - 1, 1)
    if month == 12:
        end = date(year + 1, 1, 31)
    elif month == 11:
        end = date(year + 1, 1, 1)
    else:
        end = date(year, month + 2, 1)
    return start, end


def audit(trips: list[dict]) -> list[dict]:
    creds = get_credentials()
    service = build("photoslibrary", "v1", credentials=creds, cache_discovery=False,
                    static_discovery=False)
    results = []
    for t in trips:
        if t.get("status") != "done":
            continue
        year, month = t.get("year"), t.get("month")
        if not (isinstance(year, int) and isinstance(month, int)):
            continue
        start, end = window_for(year, month)
        count = count_photos(service, start, end)
        results.append({
            "id": t.get("id"),
            "name": t.get("name"),
            "country": t.get("country"),
            "year": year,
            "month": month,
            "photos_in_window": count,
            "window": f"{start.isoformat()}..{end.isoformat()}",
        })
        log(f"  {t.get('id')}: {count} photos in {start}..{end}")
    return results


def render_report(results: list[dict]) -> str:
    suspect = [r for r in results if r["photos_in_window"] == 0]
    errors  = [r for r in results if r["photos_in_window"] == -1]
    ok      = [r for r in results if r["photos_in_window"] > 0]

    lines = ["# Date audit report", ""]
    lines.append(f"- **Total auditadas (done):** {len(results)}")
    lines.append(f"- **Sem fotos na janela (suspeitas):** {len(suspect)}")
    lines.append(f"- **Com fotos:** {len(ok)}")
    if errors:
        lines.append(f"- **Erros de API:** {len(errors)}")
    lines.append("")

    if suspect:
        lines.append("## Suspeitas (0 fotos na janela ±1 mês)")
        lines.append("")
        lines.append("| id | name | country | year-month | janela |")
        lines.append("|---|---|---|---|---|")
        for r in suspect:
            lines.append(
                f"| `{r['id']}` | {r['name']} | {r['country']} | "
                f"{r['year']}-{r['month']:02d} | {r['window']} |"
            )
        lines.append("")
        lines.append("> Datas com **0 fotos** na janela são fortes candidatas a erro de ano/mês. "
                     "Verifique abrindo Google Photos na data real e confronte com `trips.json`.")
        lines.append("")

    lines.append("## Todas as viagens auditadas")
    lines.append("")
    lines.append("| id | year-month | photos |")
    lines.append("|---|---|---|")
    for r in sorted(results, key=lambda x: (x["year"], x["month"])):
        c = r["photos_in_window"]
        cstr = "erro" if c == -1 else str(c)
        lines.append(f"| `{r['id']}` | {r['year']}-{r['month']:02d} | {cstr} |")
    lines.append("")

    return "\n".join(lines)


def main() -> int:
    data = json.loads(TRIPS_PATH.read_text(encoding="utf-8"))
    trips = data.get("trips", [])
    log(f"Auditing {sum(1 for t in trips if t.get('status') == 'done')} done trips…")
    results = audit(trips)
    report = render_report(results)
    REPORT_PATH.write_text(report, encoding="utf-8")
    log(f"Wrote {REPORT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

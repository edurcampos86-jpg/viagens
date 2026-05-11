"""
auth.py — one-time local OAuth bootstrap.

Run this ONCE on your laptop to obtain a refresh token for Gmail + Google Photos.

Usage:
    pip install -r scripts/requirements.txt
    python scripts/auth.py path/to/client_secret.json

It opens a browser for you to grant access, then prints the refresh token.
Copy that token into GitHub repo Secrets as GOOGLE_REFRESH_TOKEN. Also paste
the client_id and client_secret from your OAuth client into GOOGLE_CLIENT_ID
and GOOGLE_CLIENT_SECRET secrets.
"""

import json
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/photoslibrary.readonly",
]


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python scripts/auth.py path/to/client_secret.json", file=sys.stderr)
        return 1

    client_secret = Path(sys.argv[1])
    if not client_secret.exists():
        print(f"Not found: {client_secret}", file=sys.stderr)
        return 2

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    with open(client_secret) as f:
        secret = json.load(f)
    inner = secret.get("installed") or secret.get("web") or {}

    print("\n" + "=" * 60)
    print("Copy each of these as a GitHub repository secret:")
    print("=" * 60)
    print(f"GOOGLE_CLIENT_ID     = {inner.get('client_id')}")
    print(f"GOOGLE_CLIENT_SECRET = {inner.get('client_secret')}")
    print(f"GOOGLE_REFRESH_TOKEN = {creds.refresh_token}")
    print("=" * 60)
    print("Path: GitHub → repo → Settings → Secrets and variables → Actions")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

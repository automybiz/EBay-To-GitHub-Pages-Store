import json
import urllib.request
import urllib.error

USER = "sales@europartswest.com"
KEY = "4fb37ea6bb7749be878e1526cc8e4e4f"

# ---------------------------------------------------------
# Step 1: Exchange User Credentials for a Bearer JWT Token
# ---------------------------------------------------------
auth_url = "https://api.partstech.com/oauth/access"

# Formatted according to PartsTech's accessType schema
auth_payload = json.dumps({
    "accessType": "user",
    "credentials": {
        "user": {
            "name": USER,
            "key": KEY
        }
    }
}).encode("utf-8")

auth_req = urllib.request.Request(
    auth_url,
    data=auth_payload,
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "TerminalTest/1.0"
    },
    method="POST"
)

try:
    with urllib.request.urlopen(auth_req) as response:
        auth_data = json.loads(response.read().decode())
        token = auth_data.get("token") or auth_data.get("accessToken")
        print(" AUTH SUCCESS! Token received:")
        print(token[:40] + "...\n")
except urllib.error.HTTPError as e:
    print(" AUTH FAILED - HTTP ERROR:", e.code)
    print("BODY:", e.read().decode())
    exit()

# ---------------------------------------------------------
# Step 2: Use Bearer Token to Query the Catalog
# ---------------------------------------------------------
catalog_url = "https://api.partstech.com/catalog/brands"

catalog_req = urllib.request.Request(
    catalog_url,
    headers={
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
        "User-Agent": "TerminalTest/1.0"
    },
    method="GET"
)

try:
    with urllib.request.urlopen(catalog_req) as response:
        print(" CATALOG SUCCESS! HTTP:", response.status)
        data = response.read().decode()
        print("DATA PREVIEW:", data[:300])
except urllib.error.HTTPError as e:
    print(" CATALOG FAILED - HTTP ERROR:", e.code)
    print("BODY:", e.read().decode())
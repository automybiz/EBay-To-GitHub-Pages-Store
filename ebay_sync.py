#!/usr/bin/env python3
"""
ebay_sync.py - Rich-data eBay store sync for the EuroPartsWest GitHub Pages store.

Upgraded successor to `ebay_sync_example.py`. This script is intentionally
NON-DESTRUCTIVE: it never touches the legacy script or the root `products.json`.

What it does
------------
1. Authenticates against the eBay Buy API (client-credentials app token).
2. Pages through every active listing for the configured seller.
3. For each listing it calls getItem to pull *rich* data:
     - a high-resolution primary image (up-scaled to s-l1600)
     - the full image gallery (additionalImages)
     - item specifics / aspects (Brand, MPN, ...)
     - brand + manufacturer part number
     - the item description
     - condition and estimated availability
4. Sanitises every description (strips Google-Sheets origin wrappers, inline
   styles/classes and eBay/Sheets tracking attributes) so the JSON stays tiny.
5. Writes the same clean dataset to BOTH:
     - src/data/ebay-products.json    (imported by the Astro build)
     - public/data/ebay-products.json (served at /data/ebay-products.json)

Only the Python standard library is required (no pip installs). Credentials are
read from a local .env file (see .env.example) or the process environment.
"""

import base64
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
EBAY_STORE_URL = "https://www.ebay.com/str/europartswestllc"

# The same dataset is written to two places: the file the Astro build imports,
# and a copy under public/ so it is also served as a plain relative file at
# /data/ebay-products.json on *any* domain (GitHub Pages, GoDaddy, Cloudflare).
OUTPUT_PATHS = [
    os.path.join("src", "data", "ebay-products.json"),
    os.path.join("public", "data", "ebay-products.json"),
]

# eBay's largest standard (non-zoom) image rendition.
HIGH_RES_SIZE = "s-l1600"

# Polite pause between per-item getItem calls (seconds).
REQUEST_DELAY = 0.15

# Matches an eBay image size token, e.g. "s-l225.jpg" or "s-l500.webp".
_SIZE_RE = re.compile(r"s-l\d+(\.(?:jpg|jpeg|png|webp|gif))", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Description HTML cleaning
# ---------------------------------------------------------------------------
# Google Sheets wraps exported markup in a custom origin element we don't need.
_GSHEETS_ORIGIN_RE = re.compile(r"</?google-sheets-html-origin[^>]*>", re.IGNORECASE)

# Whole elements that carry no catalogue content (analytics, share widgets and
# inline styling). The element *and its body* are removed.
_DROP_ELEMENT_RE = re.compile(
    r"<(script|style|svg)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL
)

# Safety net for any <script>/<style>/<svg> left without a closing tag, so an
# injected description can never ship executable markup.
_STRAY_TAG_RE = re.compile(r"</?(?:script|style|svg)\b[^>]*>", re.IGNORECASE)

# One start/end tag at a time, so attributes can be filtered per tag.
_TAG_RE = re.compile(
    r"""<\s*(/?)\s*([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>"""
)

# One attribute (with an optional value) inside a tag.
_ATTR_RE = re.compile(
    r"""\s+([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?"""
)

# The only attributes worth keeping: table structure, media and links. Every
# other attribute on an eBay description is inline presentation (style, class,
# <font face/color/size>, bgcolor) or tracking junk (data-*, aria-*, ng-*,
# data-sheets-* and eBay's opaque analytics attributes) that merely bloats the
# file. colspan/rowspan and hyperlink/media src are preserved.
_KEEP_ATTRS = frozenset({
    "colspan", "rowspan", "scope",                # table structure
    "src", "srcset", "alt", "width", "height",    # media
    "href", "target", "rel", "title",             # links / tooltips
})


def _keep_attr(match):
    """Return an attribute only when its (lowercased) name is allow-listed."""
    return match.group(0) if match.group(1).lower() in _KEEP_ATTRS else ""


def clean_description(html):
    """Strip heavy, non-content markup from a raw eBay description.

    The legacy descriptions arrive as Google-Sheets / eBay widget HTML littered
    with inline ``style``/``class``/``data-sheets-*`` attributes, ``ng-*`` and
    ``aria-*`` hooks, multi-hundred-byte tracking attributes, presentational
    ``<font face color size>`` tags and whole ``<script>``/``<style>``/``<svg>``
    widgets. None of it affects the catalogue, yet it accounted for ~90% of the
    JSON, so *structure* is kept (every tag, plus ``colspan``/``rowspan``, media
    ``src``/``alt`` and hyperlink ``href``) and everything else is dropped.

    Plain-text descriptions pass through untouched.
    """
    if not html:
        return html

    html = _GSHEETS_ORIGIN_RE.sub("", html)
    html = _DROP_ELEMENT_RE.sub("", html)
    html = _STRAY_TAG_RE.sub("", html)

    def rebuild(match):
        closing, name, attrs = match.group(1), match.group(2), match.group(3)
        if closing:
            return f"</{name}>"
        return f"<{name}{_ATTR_RE.sub(_keep_attr, attrs)}>"

    return _TAG_RE.sub(rebuild, html)


def load_dotenv():
    """Parse a local .env file without external dependencies (python-dotenv)."""
    if os.path.exists(".env"):
        with open(".env", "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, val = line.split("=", 1)
                    os.environ[key.strip()] = val.strip()


load_dotenv()

EBAY_APP_ID = os.environ.get("EBAY_APP_ID")
EBAY_DEV_ID = os.environ.get("EBAY_DEV_ID")
EBAY_CERT_ID = os.environ.get("EBAY_CERT_ID")
EBAY_SELLER_ID = os.environ.get("EBAY_SELLER_ID", "europartswestcom")
EBAY_ENV = os.environ.get("EBAY_ENV", "production").lower()


def api_root():
    """Return the correct REST API host for the configured environment."""
    if EBAY_ENV == "sandbox":
        return "https://api.sandbox.ebay.com"
    return "https://api.ebay.com"


def to_highres(url):
    """Up-scale an eBay image URL to the s-l1600 rendition (best effort)."""
    if not url:
        return url
    if _SIZE_RE.search(url):
        return _SIZE_RE.sub(HIGH_RES_SIZE + r"\1", url)
    return url


def get_oauth_token():
    """Obtain a 2-hour Application Access Token via client_credentials."""
    if not EBAY_APP_ID or not EBAY_CERT_ID:
        print("Missing EBAY_APP_ID or EBAY_CERT_ID. Cannot authenticate.")
        return None

    url = f"{api_root()}/identity/v1/oauth2/token"
    credentials = f"{EBAY_APP_ID}:{EBAY_CERT_ID}"
    encoded = base64.b64encode(credentials.encode()).decode()
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": f"Basic {encoded}",
    }
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": "https://api.ebay.com/oauth/api_scope",
    }).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        print(f"Requesting fresh OAuth token from eBay ({EBAY_ENV})...")
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode()).get("access_token")
    except urllib.error.HTTPError as e:
        print(f"Authentication failed: {e.code} - {e.reason}")
        try:
            print("Response Details:", e.read().decode())
        except Exception:
            pass
        return None
    except Exception as e:
        print(f"Error requesting OAuth token: {e}")
        return None


def fetch_listing_summaries(access_token):
    """Page through all active listings for the seller via item_summary/search."""
    base_url = f"{api_root()}/buy/browse/v1/item_summary/search"
    params = {
        "filter": f"sellers:{{{EBAY_SELLER_ID}}}",
        "category_ids": "6028",  # Motors Parts & Accessories parent category
        "limit": "100",
    }
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    }

    print(f"Syncing live listings for eBay seller: '{EBAY_SELLER_ID}'...")
    summaries = []
    page_count = 1
    while url:
        print(f"  Fetching listing page {page_count}...")
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req) as response:
                res_data = json.loads(response.read().decode())
                summaries.extend(res_data.get("itemSummaries", []))
                url = res_data.get("next")
                if url:
                    page_count += 1
        except urllib.error.HTTPError as e:
            print(f"  API request failed on page {page_count}: {e.code} - {e.reason}")
            try:
                print("  Error response details:", e.read().decode())
            except Exception:
                pass
            break
        except Exception as e:
            print(f"  Error fetching page {page_count}: {e}")
            break

    print(f"Retrieved {len(summaries)} listing summaries.")
    return summaries


def fetch_item_details(access_token, item_id):
    """Call getItem to retrieve rich detail (gallery, aspects, description...)."""
    url = (f"{api_root()}/buy/browse/v1/item/"
           f"{urllib.parse.quote(item_id)}?fieldgroups=PRODUCT")
    headers = {
        "Authorization": f"Bearer {access_token}",
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as e:
        print(f"    getItem failed for {item_id}: {e.code} - {e.reason}")
    except Exception as e:
        print(f"    getItem error for {item_id}: {e}")
    return None


def _aspect_pair(aspect):
    """Normalise an aspect entry into a (name, value) pair across API shapes."""
    name = aspect.get("name") or aspect.get("localizedName")
    value = aspect.get("value")
    if value is None:
        values = aspect.get("localizedValues")
        if isinstance(values, list) and values:
            value = values[0]
    return name, value


def aspects_to_dict(item):
    """Flatten localizedAspects (and product aspects) into a name->value dict."""
    specifics = {}
    for aspect in item.get("localizedAspects", []) or []:
        name, value = _aspect_pair(aspect)
        if name and value is not None:
            specifics[name] = value
    product = item.get("product", {}) or {}
    for aspect in product.get("aspects", []) or []:
        name, value = _aspect_pair(aspect)
        if name and value is not None and name not in specifics:
            specifics[name] = value
    return specifics


def first_matching(specifics, *keys):
    """Case-insensitive lookup of the first matching aspect value."""
    lowered = {k.lower(): v for k, v in specifics.items()}
    for key in keys:
        if key.lower() in lowered:
            return lowered[key.lower()]
    return None


def collect_images(item):
    """Return a de-duplicated, up-scaled gallery (primary image first)."""
    urls = []
    primary = (item.get("image") or {}).get("imageUrl")
    if primary:
        urls.append(primary)
    for extra in item.get("additionalImages", []) or []:
        if extra.get("imageUrl"):
            urls.append(extra["imageUrl"])

    images = []
    for url in urls:
        hi = to_highres(url)
        if hi not in images:
            images.append(hi)
    return images


def estimated_quantity(item):
    """Best-effort availability quantity (Browse API exposes estimates only)."""
    for availability in item.get("estimatedAvailabilities", []) or []:
        qty = availability.get("estimatedAvailableQuantity")
        if qty is not None:
            return qty
    return None


def legacy_id_from(item_id):
    """Parse the legacy item id from a RESTful id (v1|110552431872|0)."""
    return item_id.split("|")[1] if "|" in item_id else item_id


def build_product(summary, detail):
    """Merge a search summary with its rich getItem detail into one record."""
    merged = dict(summary)
    if detail:
        merged.update(detail)

    item_id = merged.get("itemId", "")
    legacy_id = legacy_id_from(item_id)
    sku = f"EB-{legacy_id}"

    price_dict = merged.get("price", {}) or {}
    price_val = float(price_dict.get("value", 0.0) or 0.0)

    images = collect_images(merged)
    specifics = aspects_to_dict(merged)
    product = merged.get("product", {}) or {}

    brand = (merged.get("brand") or product.get("brand")
             or first_matching(specifics, "Brand"))
    mpn = (merged.get("mpn") or product.get("mpn")
           or first_matching(specifics, "Manufacturer Part Number", "MPN", "Part Number"))

    return {
        "id": sku,
        "sku": sku,
        "legacy_item_id": legacy_id,
        "source": "eBay",
        "title": merged.get("title", ""),
        "price": price_val,
        "currency": price_dict.get("currency", "USD"),
        "image": images[0] if images else "",
        "images": images,
        "url": merged.get("itemWebUrl", EBAY_STORE_URL),
        "condition": merged.get("condition"),
        "condition_description": merged.get("conditionDescription"),
        "brand": brand,
        "mpn": mpn,
        "specifics": specifics,
        "description": clean_description(merged.get("description")),
        "estimated_quantity": estimated_quantity(merged),
        "category": merged.get("categoryPath") or merged.get("categoryId"),
    }


def mock_products():
    """Minimal rich sample so the pipeline can be tested without credentials."""
    return [
        {
            "id": "EB-110552431872",
            "sku": "EB-110552431872",
            "legacy_item_id": "110552431872",
            "source": "eBay",
            "title": "Porsche 911 (991) LED Headlight Assembly - Right",
            "price": 1450.0,
            "currency": "USD",
            "image": "https://images.unsplash.com/photo-1506469717960-433cebe3f181?auto=format&fit=crop&q=80&w=1600",
            "images": [
                "https://images.unsplash.com/photo-1506469717960-433cebe3f181?auto=format&fit=crop&q=80&w=1600",
                "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&q=80&w=1600",
            ],
            "url": EBAY_STORE_URL,
            "condition": "New",
            "condition_description": "Brand new, sealed in box.",
            "brand": "Porsche",
            "mpn": "99163119600",
            "specifics": {
                "Brand": "Porsche",
                "Manufacturer Part Number": "99163119600",
                "Placement on Vehicle": "Front, Right",
            },
            "description": "<p>Genuine Porsche 911 (991) LED headlight assembly.</p>",
            "estimated_quantity": 3,
            "category": "eBay Motors:Parts & Accessories",
        },
        {
            "id": "EB-110552431873",
            "sku": "EB-110552431873",
            "legacy_item_id": "110552431873",
            "source": "eBay",
            "title": "Porsche 911 GT3 Carbon Fiber Rear Wing Spoiler",
            "price": 3895.0,
            "currency": "USD",
            "image": "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&q=80&w=1600",
            "images": [
                "https://images.unsplash.com/photo-1614162692292-7ac56d7f7f1e?auto=format&fit=crop&q=80&w=1600",
            ],
            "url": EBAY_STORE_URL,
            "condition": "New",
            "condition_description": "New with tags.",
            "brand": "Porsche",
            "mpn": "99151220300",
            "specifics": {
                "Brand": "Porsche",
                "Manufacturer Part Number": "99151220300",
                "Material": "Carbon Fiber",
            },
            "description": "<p>Lightweight carbon fiber rear wing spoiler for the 911 GT3.</p>",
            "estimated_quantity": 1,
            "category": "eBay Motors:Parts & Accessories",
        },
    ]


def write_output(products):
    """Write the dataset to every configured output path (creating folders).

    The payload is serialised once (``indent=2`` keeps the file compact while
    staying human-diffable) and written verbatim to each target, so the Astro
    import and the publicly served copy can never drift apart.
    """
    payload = json.dumps(products, indent=2, ensure_ascii=False)
    for path in OUTPUT_PATHS:
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(payload)
        print(f"Wrote {len(products)} products to {path}")


def sync():
    """Full pipeline: authenticate, list, enrich each item, write the dataset."""
    access_token = None
    if EBAY_APP_ID and not EBAY_APP_ID.upper().startswith("YOUR_"):
        access_token = get_oauth_token()

    summaries = fetch_listing_summaries(access_token) if access_token else []

    if not summaries:
        print("\n--- WARNING: NO LIVE LISTINGS RETRIEVED ---")
        print("Falling back to a small rich sample dataset for pipeline testing.")
        print("Verify your .env credentials / network access to fetch real data.\n")
        write_output(mock_products())
        return

    products = []
    total = len(summaries)
    for index, summary in enumerate(summaries, start=1):
        item_id = summary.get("itemId", "")
        print(f"  [{index}/{total}] Enriching {item_id}...")
        detail = fetch_item_details(access_token, item_id)
        products.append(build_product(summary, detail))
        time.sleep(REQUEST_DELAY)

    write_output(products)


if __name__ == "__main__":
    sync()
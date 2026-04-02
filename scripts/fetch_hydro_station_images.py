"""
Hydro station image downloader
================================
Fetches station images from the BAFU hydrodaten portal for all unique
station keys found in the 4 hydro sensor GeoJSON APIs.

Image URL pattern: https://www.hydrodaten.admin.ch/documents/Stationsbilder/P{id}.png

Outputs:
  public/geodata/outputs/hydro_img/{station_id}.png

Usage:
    python scripts/fetch_hydro_station_images.py          # run from project root
    python scripts/fetch_hydro_station_images.py --dry-run  # print what would be fetched
"""

import argparse
import json
import time
import urllib.request
import urllib.error
from pathlib import Path

IMG_DIR = Path("public/geodata/outputs/hydro_img")

IMG_URL = "https://www.hydrodaten.admin.ch/documents/Stationsbilder/P{station_id}.png"

APIS = [
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_pq.geojson",
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_temperature.geojson",
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_o2.geojson",
    "https://www.hydrodaten.admin.ch/web-hydro-maps/hydro_sensor_murk.geojson",
]

DELAY = 0.3  # seconds between requests


def fetch_station_ids():
    """Fetch all unique station keys from the 4 BAFU sensor APIs."""
    ids = set()
    for url in APIS:
        print(f"  Fetching {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "hydro-image-script/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            fc = json.loads(resp.read())
        for feat in fc["features"]:
            key = str(feat["properties"]["key"])
            ids.add(key)
    return sorted(ids, key=lambda x: int(x))


def download_image(station_id, dest_path):
    url = IMG_URL.format(station_id=station_id)
    req = urllib.request.Request(url, headers={"User-Agent": "hydro-image-script/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        dest_path.write_bytes(resp.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print("Collecting station IDs from BAFU APIs...")
    station_ids = fetch_station_ids()
    print(f"Found {len(station_ids)} unique stations.")

    if not args.dry_run:
        IMG_DIR.mkdir(parents=True, exist_ok=True)

    skipped = 0
    downloaded = 0
    missing = 0
    errors = 0

    for station_id in station_ids:
        dest_path = IMG_DIR / f"{station_id}.png"

        if dest_path.exists():
            skipped += 1
            continue

        if args.dry_run:
            print(f"  WOULD FETCH {station_id}")
            continue

        try:
            download_image(station_id, dest_path)
            print(f"  IMG   {station_id}")
            downloaded += 1
        except urllib.error.HTTPError as e:
            if e.code == 404:
                missing += 1
            else:
                print(f"  ERROR {station_id} -- HTTP {e.code}")
                errors += 1
        except Exception as e:
            print(f"  ERROR {station_id} -- {e}")
            errors += 1

        time.sleep(DELAY)

    if not args.dry_run:
        print(f"Done. downloaded={downloaded} skipped={skipped} missing(404)={missing} errors={errors}")
    else:
        print("Dry run complete.")


if __name__ == "__main__":
    main()

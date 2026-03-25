"""
Glacier info & image downloader
================================
For each glacier in public/geodata/outputs/glaciers.geojson, looks up its
pk_glacier UUID in external/web_glacier_base_data.geojson, then calls
https://www.glamos.ch/geo/glacier_infos/{pk_glacier}.json to fetch
descriptions and pictures.

Outputs:
  public/geodata/outputs/glacier_txt/{sgi-id}.json  -- descriptions in 4 languages
  public/geodata/outputs/glacier_img/{sgi-id}.{ext} -- first available image

Usage:
    python scripts/fetch_glacier_info.py          # run from project root
    python scripts/fetch_glacier_info.py --dry-run  # print what would be fetched
"""

import argparse
import json
import os
import time
import urllib.request
from pathlib import Path

GLACIERS_FILE = Path("public/geodata/outputs/glaciers.geojson")
BASE_DATA_FILE = Path("external/web_glacier_base_data.geojson")
IMG_DIR = Path("public/geodata/outputs/glacier_img")
TXT_DIR = Path("public/geodata/outputs/glacier_txt")

INFO_URL = "https://www.glamos.ch/geo/glacier_infos/{pk_glacier}.json"
IMG_URL = "https://www.glamos.ch/geo/glacier_images/{filename}"

DELAY = 0.3  # seconds between requests


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_pk_map(base_data):
    """Build a dict mapping pk_sgi -> pk_glacier."""
    pk_map = {}
    for feature in base_data["features"]:
        props = feature.get("properties", {})
        pk_sgi = props.get("pk_sgi")
        pk_glacier = props.get("pk_glacier")
        no_data = props.get("no_data", 0)
        if pk_sgi and pk_glacier and not no_data:
            pk_map[pk_sgi] = pk_glacier
    return pk_map


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "glacier-info-script/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def download_file(url, dest_path):
    req = urllib.request.Request(url, headers={"User-Agent": "glacier-info-script/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        dest_path.write_bytes(resp.read())


def extract_descriptions(info):
    """Return dict with de/fr/it/en descriptions from the info JSON.

    API structure: info["texts"] is a list of { language, description, citation }.
    """
    by_lang = {
        entry["language"]: entry.get("description", "")
        for entry in info.get("texts", [])
        if "language" in entry
    }
    return {lang: by_lang.get(lang, "") for lang in ("de", "fr", "it", "en")}


def find_first_picture(info):
    """Return filename of the first picture, or None.

    API structure: info["pictures"] is a list of { filename, legend, is_factsheet_picture }.
    """
    pictures = info.get("pictures", [])
    if pictures:
        return pictures[0].get("filename")
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    glaciers = load_json(GLACIERS_FILE)
    base_data = load_json(BASE_DATA_FILE)
    pk_map = build_pk_map(base_data)

    if not args.dry_run:
        IMG_DIR.mkdir(parents=True, exist_ok=True)
        TXT_DIR.mkdir(parents=True, exist_ok=True)

    sgi_ids = [f["properties"]["sgi-id"] for f in glaciers["features"]]
    print(f"Processing {len(sgi_ids)} glaciers...")

    for sgi_id in sgi_ids:
        pk_glacier = pk_map.get(sgi_id)
        if not pk_glacier:
            print(f"  SKIP {sgi_id} -- no pk_glacier found")
            continue

        txt_path = TXT_DIR / f"{sgi_id}.json"

        # Check if both outputs already exist (find img with any extension)
        existing_imgs = list(IMG_DIR.glob(f"{sgi_id}.*")) if IMG_DIR.exists() else []
        already_done = txt_path.exists() and existing_imgs

        if already_done:
            print(f"  SKIP {sgi_id} -- already downloaded")
            continue

        if args.dry_run:
            print(f"  WOULD FETCH {sgi_id} (pk_glacier={pk_glacier})")
            continue

        info_url = INFO_URL.format(pk_glacier=pk_glacier)
        try:
            info = fetch_json(info_url)
        except Exception as e:
            print(f"  ERROR {sgi_id} -- failed to fetch info: {e}")
            time.sleep(DELAY)
            continue

        # Save descriptions
        if not txt_path.exists():
            descriptions = extract_descriptions(info)
            txt_path.write_text(json.dumps(descriptions, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"  TEXT  {sgi_id}")

        # Download first image
        if not existing_imgs:
            filename = find_first_picture(info)
            if filename:
                ext = (Path(filename).suffix or ".jpg").lower()
                img_path = IMG_DIR / f"{sgi_id}{ext}"
                img_url = IMG_URL.format(filename=filename)
                try:
                    download_file(img_url, img_path)
                    print(f"  IMG   {sgi_id} ({filename})")
                except Exception as e:
                    print(f"  ERROR {sgi_id} -- failed to download image: {e}")
            else:
                print(f"  NO IMG {sgi_id} -- no picture in response")

        time.sleep(DELAY)

    print("Done.")


if __name__ == "__main__":
    main()

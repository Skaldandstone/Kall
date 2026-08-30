"""Validate the review inventory without network access or modifying images."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent
THEMES = ("edition", "vector", "horizon", "current")
SCREENS = ("brief", "opportunities", "career", "review")
DEVICES = ("desktop", "mobile")


def image_record(path):
    data = path.read_bytes()
    with Image.open(path) as picture:
        width, height = picture.size
        image_format = picture.format
        picture.verify()
    assert image_format == ("PNG" if path.suffix == ".png" else "JPEG"), path.name
    return {"path": path.relative_to(ROOT).as_posix(), "width": width,
            "height": height, "format": image_format, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def main():
    records = []
    for theme in THEMES:
        for screen in SCREENS:
            for device in DEVICES:
                path = ROOT / "screens" / f"{theme}-{screen}-{device}.jpg"
                record = image_record(path)
                assert record["width"] == (1440 if device == "desktop" else 375), record
                assert record["height"] >= (1000 if device == "desktop" else 1500), record
                records.append(record)
    for theme in THEMES[:3]:
        record = image_record(ROOT / "art" / f"{theme}-board.png")
        assert (record["width"], record["height"]) == (1536, 1024), record
        records.append(record)
    assert len(list((ROOT / "screens").glob("*.jpg"))) == 32
    assert len(list((ROOT / "art").glob("*.png"))) == 3
    assert len({r["sha256"] for r in records}) == 35, "Unexpected duplicate visual"
    for filename in ("index.html", "gallery.css", "mockup.html", "mockup.js", "mockup.css",
                     "README.md", "qa.md", "prompts.md", "browser-checks.json"):
        text = (ROOT / filename).read_text(encoding="utf-8")
        assert "\u2014" not in text, f"Em dash in {filename}"
    storyboard = ROOT.parents[1] / "docs" / "continuation" / "identity-storyboard.md"
    assert storyboard.is_file()
    assert "\u2014" not in storyboard.read_text(encoding="utf-8")
    existing_mark = ROOT.parents[1] / "apps/web/public/brand/kall-mark.svg"
    assert (ROOT / "assets/current-bindrune.svg").read_bytes() == existing_mark.read_bytes()
    checks = json.loads((ROOT / "browser-checks.json").read_text(encoding="utf-8"))
    assert len(checks) == 32, f"Expected 32 recorded browser checks, got {len(checks)}"
    assert not any(c["overflow"] for c in checks), "Horizontal overflow in browser record"
    for device in DEVICES:
        for screen in SCREENS:
            rows = [c for c in checks if c["device"] == device and c["screen"] == screen]
            assert len(rows) == 4
            assert len({c["content"] for c in rows}) == 1, f"Content differs: {screen}/{device}"
    assert all(c["approvalDisabled"] for c in checks if c["screen"] == "review")
    manifest = {"status": "candidate_not_approved", "candidateScreens": 24,
                "controlScreens": 8, "conceptBoards": 3, "visuals": records}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("PASS: 3 boards, 24 candidate screens, 8 controls; 32 browser records; identical sample content.")
    print("Image decoding, formats, dimensions, uniqueness and hashes checked. See qa.md for actual visual review.")


if __name__ == "__main__":
    main()

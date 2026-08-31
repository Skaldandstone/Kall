"""Validate the revised local review inventory without editing any image."""
import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
THEMES = ("stave", "inscription", "fjord", "current")
SCREENS = ("brief", "opportunities", "career", "review")
DEVICES = ("desktop", "mobile")


def image_record(path):
    data = path.read_bytes()
    with Image.open(path) as picture:
        width, height = picture.size
        image_format = picture.format
        picture.verify()
    assert image_format == ("PNG" if path.suffix == ".png" else "JPEG"), path
    return {"path": path.relative_to(ROOT).as_posix(), "width": width,
            "height": height, "format": image_format, "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest()}


def main():
    records = []
    for theme in THEMES:
        for screen in SCREENS:
            for device in DEVICES:
                record = image_record(ROOT / "screens" / f"{theme}-{screen}-{device}.jpg")
                assert (record["width"], record["height"]) == (
                    (1440, 1400) if device == "desktop" else (375, 1805)), record
                records.append(record)
    for theme in THEMES[:3]:
        record = image_record(ROOT / "art" / f"{theme}-board.png")
        assert (record["width"], record["height"]) == (1536, 1024), record
        records.append(record)
    assert len(list((ROOT / "screens").glob("*.jpg"))) == 32
    assert len(list((ROOT / "art").glob("*.png"))) == 3
    assert len({r["sha256"] for r in records}) == 35
    for filename in ("index.html", "review.css", "mockup.html", "mockup.js", "mockup.css",
                     "README.md", "qa.md", "prompts.md", "browser-checks.json", "build_studies.py"):
        assert "\u2014" not in (ROOT / filename).read_text(encoding="utf-8"), filename
    script = (ROOT / "mockup.js").read_text(encoding="utf-8")
    assert 'x="9.2" y="1.6" width="3.6" height="28.8"' in script
    assert 'd="M26.2 4.6 L6.8 16 L26.2 27.4"' in script
    assert 'stroke-width="4.2" stroke-linecap="butt" stroke-linejoin="miter"' in script
    repo = ROOT.parents[2]
    assert (ROOT.parent / "assets/current-bindrune.svg").read_bytes() == (
        repo / "apps/web/public/brand/kall-mark.svg").read_bytes()
    storyboard = repo / "docs/continuation/identity-storyboard.md"
    assert "\u2014" not in storyboard.read_text(encoding="utf-8")
    checks = json.loads((ROOT / "browser-checks.json").read_text(encoding="utf-8"))
    assert len(checks) == 32
    assert not any(c["overflow"] for c in checks)
    assert all(c["runeCount"] == 1 for c in checks)
    for device in DEVICES:
        for screen in SCREENS:
            rows = [c for c in checks if c["device"] == device and c["screen"] == screen]
            assert {c["theme"] for c in rows} == set(THEMES)
            assert len({c["content"] for c in rows}) == 1, (screen, device)
    assert all(c["approvalDisabled"] for c in checks if c["screen"] == "review")
    for row in checks:
        if row["device"] == "mobile":
            assert row["width"] == 375 and row["height"] == 900
            assert row["capture"]["footerBottom"] < row["capture"]["navTop"], row
            assert row["capture"]["pageHeight"] == 1805, row
    manifest = {"status": "candidate_not_approved", "round": 2, "candidateScreens": 24,
                "controlScreens": 8, "conceptBoards": 3, "visuals": records}
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("PASS: 3 rune-aligned boards, 24 candidate screens, 8 controls; 32 browser records.")
    print("Identical sample content, mobile footer clearance, exact rune source and image integrity verified.")
    print("See qa.md for separate visual inspection and limitations. No production or user approval claimed.")


if __name__ == "__main__":
    main()

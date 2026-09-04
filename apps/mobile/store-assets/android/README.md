# Android Play Store assets

- `icon-512.png` -- 512x512, no alpha. Source: `apps/mobile/assets/icon.png`
  (the app's 1024x1024 adaptive-icon foreground square), downscaled with
  ffmpeg. Play applies its own mask/shape, so this is the flat un-rounded
  square, not `apps/web/public/icon-512.png` (which is pre-rounded for the
  web favicon and wrong for this purpose).
- `feature-graphic.png` -- 1024x500, no alpha, the banner shown at the top of
  a Play Store listing. Generated with ffmpeg (`drawtext` + `overlay`) using
  the brand navy/brass palette from `apps/web/app/globals.css`
  (`--canvas: #0c1420`, `--accent: #c9a86a`, `--text: #e8ecf2`) and a system
  sans-serif rather than the web app's licensed Syne/Epilogue fonts (those are
  fetched at build time via `next/font/google` and aren't available as static
  font files in this repo). Regenerate by copying a bold + regular system
  font next to the source icon and running an ffmpeg filtergraph like:

  ```
  ffmpeg -f lavfi -i "color=c=0x0c1420:s=1024x500" -i icon.png -filter_complex \
    "[1:v]scale=320:320[icon];[0:v][icon]overlay=x=90:y=90[bg1];\
     [bg1]drawtext=fontfile=<bold>.ttf:text='Kall':fontcolor=0xc9a86a:fontsize=150:x=470:y=130[bg2];\
     [bg2]drawtext=fontfile=<regular>.ttf:text='Your job search\, organized.':fontcolor=0xe8ecf2:fontsize=42:x=474:y=300[out]" \
    -map "[out]" -frames:v 1 -update 1 feature-graphic.png
  ```

  Keep font files out of the repo (they're system fonts, not licensed for
  redistribution here) -- copy them into a scratch directory to run the
  command, not into this folder.
- `listing.md` -- short/full description copy for the Play Console listing
  form.
- `screenshots/` -- six phone screenshots (1080x1920) captured against a
  real local backend and a real (throwaway) Clerk test account named
  "John Kall", not mockups: sign-in, Applications, application review,
  Morning Brief, Opportunities, and Growth. Captured by
  `.github/workflows/mobile-store-screenshots.yml`, a manual-only
  workflow -- run it again (`gh workflow run mobile-store-screenshots.yml`)
  whenever the app's UI changes enough to make these stale. See
  `apps/mobile/e2e/store-screenshots.spec.ts` and
  `apps/mobile/e2e/seed_screenshot_data.py` for how the account and its
  sample applications are built and torn down.

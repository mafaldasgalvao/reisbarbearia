# Reis Barbearia — Landing Page

Static site built with **Eleventy**, **Tailwind CSS 4** and **daisyUI 5** (both loaded via CDN). Content is edited in the dashboard in `admin/` (see `admin/README.md`).

## Run locally
`bin/dev`, then open `http://localhost:8000`. Opening `src/index.njk` directly doesn't work.

## Where things live
- **Page layout:** `src/index.njk`
- **Content:** `src/_data/*.json` (services, gallery, reviews, O Mestre, contacts). These are the files the dashboard edits.
- **Photos:** `src/assets/`
- **Colors / fonts:** the `@theme` block at the top of `src/index.njk`

## Publish on GitHub Pages
**Settings → Pages → Source: GitHub Actions.** Each push to `main` runs `.github/workflows/deploy-pages.yml`, which builds `_site/` and publishes it.

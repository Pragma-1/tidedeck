# Tidedeck chapter for Tidewiki

The user documentation as a Tidewiki chapter: `tidedeck/` holds the pages, `_media/` the screenshots.

**Import:** in Tidewiki, **Settings → Import** (administrators), choose `tidedeck-docs.zip` from the release or build it yourself:

```bash
cd docs/tidewiki && zip -r ../../tidedeck-docs.zip tidedeck _media
```

The preview lists one chapter (_Tidedeck_) with nine pages and nine images. Pages are linked with `[[slug|text]]`, so they keep working wherever the chapter sits in the wiki.

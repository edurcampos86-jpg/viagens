"""Testes da lógica pura de sync_photos.py (matching, public_id, apply).

Não exercita Google API nem Cloudinary — só funções determinísticas.
"""

from __future__ import annotations

import unittest

from sync_photos import (
    apply_photos_to_trip,
    match_albums,
    public_id_for,
    sanitize_basename,
    slug_from_album_title,
)


class SlugFromAlbumTitleTests(unittest.TestCase):
    def setUp(self):
        self.slugs = {"brussels-2026", "iguacu-2021", "japao-2027", "japao-2023"}

    def test_exact_match(self):
        self.assertEqual(slug_from_album_title("brussels-2026", self.slugs), "brussels-2026")

    def test_with_em_dash_suffix(self):
        self.assertEqual(
            slug_from_album_title("brussels-2026 — Bélgica & Tomorrowland", self.slugs),
            "brussels-2026",
        )

    def test_with_space_suffix(self):
        self.assertEqual(
            slug_from_album_title("iguacu-2021 Foz do Iguaçu", self.slugs),
            "iguacu-2021",
        )

    def test_case_insensitive(self):
        self.assertEqual(
            slug_from_album_title("BRUSSELS-2026 — viagem", self.slugs),
            "brussels-2026",
        )

    def test_no_match_when_prefix_not_followed_by_separator(self):
        # 'brussels-2026x' não deve casar com 'brussels-2026'
        self.assertIsNone(slug_from_album_title("brussels-2026x extras", self.slugs))

    def test_no_match_when_unrelated(self):
        self.assertIsNone(slug_from_album_title("Férias 2020", self.slugs))

    def test_empty_title(self):
        self.assertIsNone(slug_from_album_title("", self.slugs))
        self.assertIsNone(slug_from_album_title(None, self.slugs))

    def test_prefers_longest_match(self):
        # Caso onde dois slugs poderiam casar: 'japao-2023' e 'japao' (se existisse).
        # Como temos só 'japao-2027' e 'japao-2023', verifica o desempate por ano.
        self.assertEqual(
            slug_from_album_title("japao-2027 - Hokkaido", self.slugs),
            "japao-2027",
        )
        self.assertEqual(
            slug_from_album_title("japao-2023 - Tokyo", self.slugs),
            "japao-2023",
        )


class SanitizeBasenameTests(unittest.TestCase):
    def test_lowercases_and_strips_special(self):
        self.assertEqual(sanitize_basename("Foto Bonita.JPG"), "foto-bonita-jpg")

    def test_handles_unicode(self):
        self.assertEqual(sanitize_basename("São Paulo - 01"), "s-o-paulo-01")

    def test_fallback_when_empty(self):
        self.assertEqual(sanitize_basename(""), "photo")
        self.assertEqual(sanitize_basename("!!!"), "photo")


class PublicIdTests(unittest.TestCase):
    def test_deterministic(self):
        media = {"id": "abc123XYZ", "filename": "IMG_001.HEIC"}
        a = public_id_for("brussels-2026", media)
        b = public_id_for("brussels-2026", media)
        self.assertEqual(a, b)
        self.assertTrue(a.startswith("viagens/brussels-2026/"))

    def test_includes_filename_stem(self):
        media = {"id": "abc", "filename": "DSC_4242.jpg"}
        pid = public_id_for("iguacu-2021", media)
        self.assertIn("dsc-4242", pid)

    def test_different_ids_give_different_public_ids(self):
        a = public_id_for("x", {"id": "id-A", "filename": "same.jpg"})
        b = public_id_for("x", {"id": "id-B", "filename": "same.jpg"})
        self.assertNotEqual(a, b)


class MatchAlbumsTests(unittest.TestCase):
    def setUp(self):
        self.known = {"brussels-2026", "iguacu-2021"}
        self.albums = [
            {"id": "A1", "title": "brussels-2026 — Bélgica"},
            {"id": "A2", "title": "Random album"},
            {"id": "A3", "title": "iguacu-2021"},
            {"id": "A4", "title": "iguacu-2021 raw"},
        ]

    def test_matches_only_albums_that_start_with_known_slug(self):
        out = match_albums(self.albums, self.known, only_slug=None)
        slugs = [s for _, s in out]
        self.assertEqual(sorted(slugs), ["brussels-2026", "iguacu-2021", "iguacu-2021"])

    def test_filters_by_only_slug(self):
        out = match_albums(self.albums, self.known, only_slug="brussels-2026")
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0][1], "brussels-2026")


class ApplyPhotosTests(unittest.TestCase):
    def test_populates_all_three_fields(self):
        trip = {"id": "brussels-2026"}
        urls = ["https://x/a.jpg", "https://x/b.jpg", "https://x/c.jpg"]
        apply_photos_to_trip(trip, urls)
        self.assertEqual(trip["gallery"], urls)
        self.assertEqual(trip["photo"], urls[0])
        self.assertEqual(trip["fotos"][0], {"url": urls[0], "destaque": True})
        self.assertEqual(trip["fotos"][1], {"url": urls[1]})
        self.assertEqual(trip["fotos"][2], {"url": urls[2]})


if __name__ == "__main__":
    unittest.main()

# Unicode data

The Username Transformation Engine reads these files at startup. They are the official Unicode data files,
unmodified, version **16.0.0** (the same Unicode version as Node.js 22's built-in ICU normalizer).

| File              | What the engine uses it for                                           | Source                                                   |
| ----------------- | --------------------------------------------------------------------- | -------------------------------------------------------- |
| `UnicodeData.txt` | Names, general category, bidi class, decomposition tags (`<font>`, …) | UCD 16.0.0 (`Public/16.0.0/ucd/`)                        |
| `Scripts.txt`     | Script of each character (mixed-script detection)                     | UCD 16.0.0                                               |
| `DerivedAge.txt`  | Unicode version that introduced a character (font coverage estimate)  | UCD 16.0.0                                               |
| `confusables.txt` | UTS #39 visual confusable mappings (the `skeleton()` prototypes)      | UTS #39 security data 16.0.0 (`Public/security/16.0.0/`) |

These copies came from Ubuntu's `unicode-data 16.0.0` package and ICU 76.1's `source/data/unidata/`, which ship
the files byte-for-byte from unicode.org.

To update, download the same four files for a newer version from https://www.unicode.org/Public/ and replace them.
Keep `confusables.txt` and the UCD files at the same version.

Licensed under the Unicode License V3, see `LICENSE` in this folder.

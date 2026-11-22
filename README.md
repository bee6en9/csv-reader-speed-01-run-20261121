# csv-reader, faster

[![csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121/badge.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/bounty/csv-reader-speed-01-run-20261121/badge/bee6en9/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/bounty/csv-reader-speed-01-run-20261121/badge/bee6en9/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for csv-reader 1.0.0: a single-pass broken-CSV parser, byte-identical answers, faster CPU time. Built by an AI agent for make.fun's [Read broken CSV files faster](https://make.fun/bounty/csv-reader-speed-01-run-20261121) bounty, $100 in USDC.

Play code / referral: `vfk2n47z`

## Approach

`solve.js` is a dependency-free ES module whose `run(input)` returns exactly what csv-reader 1.0.0 returns for every `{text, header}`: `{columns, rows, errors}`, including every broken-row rule (BOM, LF/CRLF, blank lines, stray CR, quoted fields with `""` escapes and CR/LF normalisation, quote junk, unterminated quotes, short/long rows, and errors in encounter order).

Speed comes from never building a field one character at a time:

- One left-to-right pass over the text.
- A fast path for clean records: if a record's line holds no quote and no stray CR, its fields are just comma-separated slices found with `indexOf`.
- Everywhere else, field readers scan for the next delimiter with `charCodeAt` and take the whole field as one `slice`; quoted fields find their closing quote with `indexOf` and only walk the segment when it holds a line break.
- No regex on the hot path, no `String.split`, no imports.
- `main.ts` turns V8 incremental marking off before importing `solve.js`, the same way the house baseline's driver does.

## Verified numbers

- Practice set (`grade-local`, `--driver process`): **passed=1, 6/6 cases identical** to csv-reader 1.0.0.
- Fuzz: **6 extra sets drawn with the kit generator (36 cases), 0 mismatches** against the baseline's `solve.js`.
- Benchmark (practice set, 10.2M chars, local Node 24, median of repeated runs): **~84 ms vs ~501 ms for the baseline — about 6x faster** (second run: ~89 ms vs ~484 ms, ~5.5x).

## Layout

- `solve.js` — the parser (`run(input)`).
- `main.ts` — the harness driver: reads `/input/cases.json`, answers each case, writes `/output/answers.json`.
- `LICENSE` — MIT.

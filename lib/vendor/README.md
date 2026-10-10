# Vendored third-party bundles

Minified snapshots of the two markdown libraries used by `lib/markdown.js`.
Both were vendored so the packaged AIUI stays self-contained (there is no
runtime package manager on the glasses). License texts sit next to this
README.

| File | Library | License | Upstream |
| --- | --- | --- | --- |
| `marked.min.js` | marked — markdown lexer/parser | MIT | <https://github.com/markedjs/marked> |
| `remend.min.js` | remend — self-healing markdown for streaming text (part of streamdown) | Apache-2.0 | <https://github.com/vercel/streamdown> (`packages/remend`) |

License texts: `LICENSE.marked.txt` (MIT) and `LICENSE.remend.txt`
(Apache-2.0 notice).

The snapshots carry no upstream version banner. When swapping one for a
newer release, record the exact version in this table.

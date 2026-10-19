# Third-party notices

Nudge’s own code is proposed under the MIT license in `LICENSE`. That does not replace the licenses of dependencies or copied components. A scanner passing is not legal clearance.

## Copied components

UI components under `apps/extension/components/nexus-ui` and `apps/extension/src/components/nexus-ui` are adapted from [Nexus UI](https://nexus-ui.dev) by Victor Williams (design by Michael Odunsi). Nexus UI is MIT licensed.

```
MIT License

Copyright (c) 2025 Victor Williams

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Dependency inventory

Runtime and development packages are installed from `pnpm-lock.yaml`. Their SPDX identifiers are listed in `docs/release/dependency-licenses.txt`, generated from the lockfile install with `pnpm licenses list`. Review that file before publication. Notable obligations:

- Radix UI primitives, Zod, Fastify, React, and TypeScript-related packages are commonly MIT. Confirm the generated list.
- `lucide-react` is ISC.
- The OpenAI Node SDK is Apache-2.0.
- PDF.js (`pdfjs-dist`) is Apache-2.0.
- `jszip` is dual-licensed MIT OR GPL-3.0-or-later. Nudge elects the MIT option. `mammoth` (DOCX text extraction) is BSD-2-Clause and depends on it.
- Icons in `apps/extension/public/icons` and `assets/brand` are project assets. Store screenshots under `assets/store` were produced for this project; do not add screenshots of real accounts.

If a dependency license is missing from the generated list, do not guess it.

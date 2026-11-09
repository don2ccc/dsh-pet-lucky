# Third-party notices

This package bundles or derives from the following third-party work. The MIT
licence in `LICENSE` applies to this project's own code only.

## three.js r147

Inlined into `client.js` (look for the `three.js r147` banner).

> The MIT License
>
> Copyright © 2010-2022 three.js authors
> https://github.com/mrdoob/three.js

## GLTFLoader

Inlined into `client.js`; part of the three.js examples (`examples/js/loaders`),
distributed under the same MIT licence.

## Cove Parrot (3D model and artwork)

- Model: **Cove Parrot** by Polyfork — https://polyfork.dev/asset/cove-parrot-17850c
- Licence chosen for the model files: **CC BY 4.0** — https://creativecommons.org/licenses/by/4.0/
- Required credit line, reproduced here per the licence:
  `Cove Parrot by Polyfork (https://polyfork.dev/asset/cove-parrot-17850c), CC BY 4.0`

The `.glb` itself is **not redistributed** in this repository. It is downloaded at
runtime from Polyfork's public CDN (`https://polyfork.dev/cdn/cove-parrot-17850c.glb`),
which serves it with `Access-Control-Allow-Origin: *` and no authentication.

The 2D fallback artwork in `assets/*.webp` is **derived from Polyfork's official
renders** of that model (backgrounds removed, scaled, re-encoded), and is
redistributed here under the same CC BY 4.0 terms with the credit line above.

Polyfork's alternative "Polyfork licence" (commercial use, no attribution, no
redistribution) is **not** the one used here, because this repository does
redistribute derived artwork.

# LHEA-TEMA Kernel

**LHEA-TEMA Kernel Worker v2 + Workers AI** — a [Cloudflare Worker](https://developers.cloudflare.com/workers/) (ESM, `export default { fetch }`) that runs a small linguistic/semantic "kernel."

At its core, the kernel resolves **ISA triplets** — a *Latin root*, a *Hebrew glyph*, and an *Indus icon* — against a D1-backed registry, and uses each execution to evolve a layered context-memory model called **TEMA**:

- **Core** — active context droplets, ranked by an `eigenvalue_weight`.
- **Ocean** — droplets shed from Core once their weight decays, circulating until they either re-enter Core or precipitate.
- **Cave** — long-lived "stalactites" precipitated out of Ocean droplets that have circulated enough times.

Memory pressure in Core is managed by an **EBA** (eigenvalue-based attention) pass: it damps an over-dominant droplet (`λmax > 0.85`), and sheds or ejects droplets whose weight falls below threshold (to Ocean, or to a `FIRMAMENT` layer if also under-myelinated). Repeated use of a Latin root "myelinates" it — after 10 uses it hardens from a `MODULAR_NODE` into a `CORE_NODE`, which the kernel then refuses to "diminish." Latin roots can also be checked for emergent **jurisdictions**: groups of 3+ roots whose combined glyph operator classes must not mix `PERCEPTION` and `STRUCTURAL` without a `COGNITIVE` bridge.

The kernel also exposes an `/ai/chat` endpoint that proxies to [Workers AI](https://developers.cloudflare.com/workers-ai/) (default model `@cf/meta/llama-3.3-70b-instruct-fp8-fast`), injecting a live snapshot of kernel state (root/glyph/icon counts, λmax, C_scope) into the first system message before each call.

A `/scene` endpoint packages the whole registry + TEMA state into a 3D-renderable scene graph (Fibonacci-sphere lattice of root nodes, orbiting Ocean droplets, hanging Cave stalactites, Nexus valve connections) for a front-end visualizer.

## Bindings required

This Worker does nothing on its own — it needs these bindings configured in the Cloudflare dashboard (or `wrangler.toml`):

| Binding          | Type       | Notes                              |
|-------------------|-----------|-------------------------------------|
| `STAMP_REGISTRY`  | D1        | `mashet-stamp-registry` — Latin roots, Hebrew glyphs, root↔glyph affinities |
| `WORLD_STATE`     | D1        | `mashet-world-state` — Indus icons, glyph activations, domain observations, jurisdictions |
| `TEMA_SUBSTRATE`  | D1        | `mashet-tema-substrate` — Core/Ocean/Cave droplets, Nexus valves, EBA log |
| `AI`              | Workers AI | Only needed for `/ai/chat`; other routes work without it |

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Kernel status, DB names, whether `AI` is bound |
| POST | `/ai/chat` | Chat via Workers AI with live kernel context injected |
| GET | `/registry/root?root=` | Resolve a Latin root and its glyph affinities |
| GET | `/registry/glyph?name=` | Resolve a Hebrew glyph and its affined roots |
| GET | `/registry/roots` | List all Latin roots |
| GET | `/registry/glyphs` | List all Hebrew glyphs |
| POST | `/kernel/execute` | Execute an ISA triplet (`latin_root`, `hebrew_glyph`, `indus_icon`, optional `context`) |
| GET | `/tema/core` | Core layer droplets, λmax, C_scope, last EBA run |
| GET | `/tema/ocean` | Ocean layer droplets (also advances circulation + precipitation) |
| GET | `/tema/cave` | Cave stalactites |
| GET | `/tema/nexus` | Nexus valve conductivity |
| POST | `/tema/eba` | Run an EBA pass on demand |
| GET | `/world/icons` | List Indus icons with augmentation counts |
| GET | `/world/icon?id=` | One icon plus its augmentations and recent activations |
| POST | `/world/observe` | Record a domain observation (Seismic/Solar/Volcanic/Oceanic/Atmospheric/Cosmic) |
| GET | `/world/jurisdictions` | List emergent jurisdictions |
| POST | `/world/jurisdiction/check` | Validate/register a jurisdiction from ≥3 root names |
| GET | `/scene` | Full scene graph for 3D visualization |

## Usage

Deploy with [`wrangler`](https://developers.cloudflare.com/workers/wrangler/), with the D1 databases and AI binding above configured, then call it like any HTTP API:

```js
import worker from './src/lhea-tema-kernel.js';

// Routes that don't touch D1/AI can be exercised directly against the exported handler:
const res = await worker.fetch(new Request('https://example.com/health'), {});
const body = await res.json();
// {
//   status: 'online',
//   system: 'LHEA-TEMA Kernel v2',
//   databases: { stamp_registry: 'mashet-stamp-registry', ... },
//   ai: 'unbound'
// }
```

Once deployed with real bindings, executing an ISA triplet looks like:

```bash
curl -X POST https://<your-worker>.workers.dev/kernel/execute \
  -H 'Content-Type: application/json' \
  -d '{"latin_root":"terr","hebrew_glyph":"ח","indus_icon":"Icon_EarthWitness"}'
```

## Development

```bash
npm test   # runs the smoke tests under test/ with node:test
```

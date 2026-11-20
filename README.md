# Wheel

Throw a pot on a simulated potter's wheel with your own (simulated) hands, then download it as an STL to 3D print.

A lump of clay has just been slapped onto the wheel, a little off-centre. Centre it, open it, pull up the walls, shape it, and trim the rim, the same sequence a potter follows. When you like it, preview a glaze and export a sealed, printable mesh in millimetres.

## Run

Open **index.html** directly in a modern browser (WebGL 2). Nothing to install.

Or serve it locally: `npm run dev`, then open http://localhost:4327.

## How to throw

Hold the **left mouse button** to touch the clay. The cursor marks the point where your hand meets the clay, on the side of the wheel facing you.

| Key | Hand | What it does |
| --- | --- | --- |
| 1 | Palms | Squeeze both sides. Centres the lump and cones it upward. |
| 2 | Press | Push the top down. The clay spreads wider. |
| 3 | Thumb | Press into the centre to open, stop above the wheel to leave a floor, drag outward to widen. |
| 4 | Pull | Pinch the wall between two fingers and lift. The wall thins and rises. Drag outward to belly, inward to collar. `[` `]` set the pinch. |
| 5 | Finger | Push the outside inward for necks and grooves. Over the top, it presses the rim down. |
| 6 | Rib | A flat tool that straightens the outside. |
| 7 | Needle | Through the wall of a spinning pot, cuts off everything above. Levels the rim. |

- **Space** starts and stops the wheel; **↑ / ↓** change speed.
- **W** sponges on water. Hands dry the clay. Dry clay drags and twists the pot out of round.
- **Z** or **Ctrl/⌘+Z** undoes a stroke. **New clay** starts over with 500 g, 1 kg or 2 kg.
- **Right-drag** or **Shift-drag** orbits the view, **scroll** zooms, **← / →** turn the view.
- **E** downloads the STL. **Scale** resizes the export (100 % is the size on the wheel).

## How the clay works

The clay is a stack of thin rings, and each ring stores a radius for 72 angles around the wheel. A ring keeps its volume forever, and its thickness is volume ÷ area, so clay is never created or lost. Squeeze a ring narrower and it gets taller, so the pot rises. Press it down and it spreads. Pinch a wall thinner and it climbs. An inside hand stretches the wall outward, and the wall thins as it bellies.

Hands only push radii. On a still wheel a hand dents just the part under it. On a turning wheel the high side of an off-centre lump meets the hand first and gets shaved down, which is what centring is. Clay yields at a limited speed (softer when wet), so a hand moved faster than the clay gives sinks into it until the clay catches up.

## STL export

`src/mesh.js` revolves each angle's closed cross-section around the axis. The ends of each section sit on the axis as single shared vertices, so the surface is closed and every edge is shared by exactly two consistently wound triangles. Z is up and the base sits at Z = 0. Walls never go below 3 mm and the floor below about 6 mm, so pots can be printed.

## Develop

- `src/clay.js`: simulation. `src/mesh.js`: mesh and STL. `src/render.js`: WebGL. `src/app.js`: input and UI.
- `npm run build` bundles `src/` into `app.bundle.js`, so the page also works from `file://`. Run it after editing.
- `npm test` runs the simulation and mesh tests.
- `npm run browser-check` throws a whole pot in headless Chrome with real mouse events and saves screenshots under `artifacts/`. If Chrome won't start from Node, start it yourself with `--remote-debugging-port=0 --user-data-dir=DIR` and set `CHROME_PROFILE=DIR`.

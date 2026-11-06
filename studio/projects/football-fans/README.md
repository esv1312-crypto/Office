# Football Fans — first playable world

This is the first product project assigned to Universal AI Studio.

## Product direction

Build a social Roblox experience about football fan culture. The first map is a fictional walkable football district, not a football match simulator. Players meet, explore, customise their fan identity, take part in activities, and gather before events.

## First milestone

Create a navigable greybox map with recognisable places and clear player flow:

1. Arrival Plaza — spawn and orientation.
2. Fan Street — the social spine connecting the district.
3. Supporters' Square — gathering and emote space.
4. Fan Shop — future cosmetics and banners.
5. Café — social hangout (fictional, non-branded).
6. Mini Pitch — small casual football activity.
7. Stadium Forecourt — event gateway and large visual landmark.
8. Main Stadium — central destination, initially a greybox shell with a visible pitch and stands.

## Build artifact

- `map-design-v1.md` — spatial brief, dimensions, zones, player journey, acceptance criteria.
- `roblox/BuildMap.server.lua` — deterministic Roblox Luau blockout generator.

## How to use the generator

1. Open a new or disposable place in Roblox Studio.
2. Open the Command Bar (View / Script tab; shortcut Ctrl+9 on Windows).
3. Paste the contents of `roblox/BuildMap.server.lua` and run it.
4. The script creates a folder named `FootballFansMap` in Workspace.
5. Play-test navigation and inspect the blockout from the spawn point.

The script only replaces its own `Workspace.FootballFansMap` folder when rerun. It does not publish the place or modify any Roblox experience online.

## Scope boundaries

This first pass intentionally avoids real club names, crests, player likenesses, copyrighted chants, monetisation, persistence, combat, and complex crowd simulation. Those require separate design and approval.

## Acceptance criteria

- All eight named zones are present.
- Main paths are at least 24 studs wide where practical.
- The stadium is visible from the main approach.
- Spawn has clear sightlines to the central plaza and route signage.
- Buildings and props are anchored and grouped under the generated folder.
- The map is traversable on foot and readable on a mobile screen.

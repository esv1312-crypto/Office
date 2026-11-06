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

## Latest blockout pass

The generator now adds a small commercial street, three additional storefronts, a café interior with an open front, street posters and fan-culture graphics, and a physics-enabled football on the mini pitch. These are prototype primitives and must be inspected in Roblox Studio for scale, collisions, visibility, and mobile readability.

## Supporter crowd prototype

The map generator now places eight lightweight, anchored supporter character stand-ins around the square, mini pitch, and stadium approach. They have fictional colour combinations, scarves, caps, and short greeting labels. A scarf rack, three supporter flags, and marked meetup pads establish the first social gathering points.

These are visual prototypes, not yet fully interactive Roblox NPCs: they do not have Humanoids, pathfinding, dialogue systems, or animated emotes. Player-controlled fan-colour selection and wearable accessories remain a separate gameplay task.

## First social gameplay interactions

The generated map now adds five proximity-prompt scarf choices: Blue, Orange, Red, Green, and White Crew. A server runtime assigns the corresponding Roblox Team, stores the selection on the Player, and attaches a simple colour-matched scarf visual and a small crew label above the character. The choice is reapplied when the character respawns.

Each of the three meetup pads also has a proximity prompt that triggers a short two-arm cheer motion by tweening the character's shoulder joints. Prompts support Roblox's built-in interaction UI across supported input methods.

This remains an early prototype. Validate Script.Source installation from the Studio Command Bar, team assignment, R6/R15 scarf placement, respawn persistence, and cheer joint behaviour in a disposable Roblox Studio place. No persistent account save or external asset dependency is included.


## Shared supporter banner interaction

Each of the three meetup pads now has a `Raise crew banner` proximity prompt. A player must first select one of the five fan groups. Activating the prompt creates or recolours a server-visible banner at that meetup location and labels it with the selected crew. Other players can replace the banner by raising their own crew's colours. A short per-player cooldown limits repeated activation.

The banner is a simple anchored primitive model and exists only for the current server session. It is not saved between sessions. Validate prompt placement, visibility from multiple approach directions, and multiplayer updates in a disposable Roblox Studio playtest.

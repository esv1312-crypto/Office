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


## Supporter crews (server-session prototype)

Players who have selected one of the five fan groups can use any meetup pad to create or join that group's supporter crew. The first player creates a session crew; later players from the same fan group join it. Crews are limited to six members. The crew name and membership/leader/size are exposed as Player attributes for later UI integration. Players can leave at any meetup pad; if the leader leaves, leadership transfers to a remaining member. Membership is session-only and is cleared when players leave the server.

This is a lightweight server-side party prototype, not a persistent clan system: there are no friend invitations, custom names, saved membership, chat channels, rewards, or cross-server crews yet. Validate multiplayer join/leave, leader handoff, crew capacity, and switching fan groups in Roblox Studio.


## Player-to-player crew invitations (prototype)

A crew leader can approach another player and use the `Invite to crew` proximity prompt attached to that player's character. The target receives an on-screen invitation with Accept and Decline buttons. Invitations expire after 30 seconds and are validated again on the server when accepted: the inviter must still lead the same crew, the target must still be without a crew and belong to the same fan group, and the crew must have an open slot (maximum six). A short inviter cooldown limits spam. Changing fan groups automatically leaves the previous crew. This is limited to players in the same server; invitations and crew membership are not persisted.

The generator installs a server runtime and a small client LocalScript for the invitation dialog. Validate prompt visibility, GUI behaviour on desktop/mobile, invitation expiry, leader departure, crew capacity, and exploit-resistant server checks in a disposable Roblox Studio multiplayer test.

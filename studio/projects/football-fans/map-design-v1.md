# Football Fans — Map Design v1

**World concept:** a fictional football district on match day. The player arrives in a lively neighbourhood, meets other supporters, visits fan locations, plays small activities, and moves toward the stadium.

**Map type:** compact social hub / walkable district with a strong central landmark.

**Blockout footprint:** approximately 1,000 × 820 studs. All dimensions are Roblox studs. The first generator uses simple anchored Parts; art, terrain, lighting polish, NPCs, and gameplay systems are later passes.

## 1. Spatial plan

Coordinate convention: north is +Z; east is +X. Spawn is near the south-west entrance. The stadium occupies the north-east quadrant.

| Zone | Approximate centre | Purpose |
|---|---:|---|
| Arrival Plaza | (-330, 0, 270) | Spawn, orientation, first meeting point |
| Fan Street | (-80, 0, 100) | Main pedestrian spine |
| Supporters' Square | (0, 0, 0) | Social heart, gathering, emotes, event announcements |
| Fan Shop | (-250, 0, -100) | Future scarves, shirts, flags, cosmetics |
| Café | (230, 0, -120) | Social hangout and rest point |
| Mini Pitch | (-270, 0, -330) | Casual football mini-game |
| Stadium Forecourt | (260, 0, 270) | Event queue, photo point, fan gathering |
| Main Stadium | (270, 0, 0) | Dominant landmark and primary destination |

## 2. Player journey

1. Spawn in Arrival Plaza; a large sign introduces the district.
2. Follow the wide Fan Street toward Supporters' Square.
3. Discover the Fan Shop and Café on side streets.
4. Find the Mini Pitch for a short skill activity.
5. See the stadium throughout the journey; enter the Stadium Forecourt.
6. Gather at the gates before a future match/event.

The map should create several short loops rather than one long corridor. Players should be able to return to the central square quickly.

## 3. Zone requirements

### Arrival Plaza
- Clear spawn platform and welcome landmark.
- Three visible directional signs: Square, Mini Pitch, Stadium.
- Open sightlines; no tall buildings immediately around spawn.

### Fan Street
- Main pedestrian route, roughly 32 studs wide.
- Street lamps, banners, low barriers, benches, and wayfinding.
- Connects the arrival area to the central square.

### Supporters' Square
- Largest public gathering space.
- Central raised platform / event stage.
- Open perimeter for groups and player screenshots.
- Space reserved for future live event UI and crowd moments.

### Fan Shop
- Distinct storefront with a large readable sign.
- Display windows and a small forecourt.
- Future interaction points for cosmetics; no real brands.

### Café
- Warm social location with tables outside.
- No alcohol-focused content.
- Future seats, emotes, chat/social interactions.

### Mini Pitch
- Small fenced football court with goals and centre line.
- Future 1v1 / keep-up / penalty mini-games.
- Keep the court separate from the main pedestrian route.

### Stadium Forecourt
- Broad approach plaza and ticket-gate blockout.
- Space for queues, banners, event countdown, and group photos.
- Stadium silhouette should be visible from here.

### Main Stadium
- Large rectangular shell with open roof.
- Visible green pitch, perimeter track, and four simple stands.
- Initial capacity is visual only; no seating logic or match simulation yet.
- The stadium is the primary navigation landmark.

## 4. Visual language

- Fictional city, contemporary urban football culture.
- Neutral concrete, asphalt, grass, and metal materials.
- Strong accent colours can be changed later through a theme configuration.
- Avoid official club identities, league marks, real sponsor logos, and copied stadium architecture.
- Prioritise silhouette, readability, and navigation over detail in this blockout.

## 5. Technical constraints

- Group all generated instances under `Workspace.FootballFansMap`.
- Anchor all static geometry.
- Use simple Parts and Models for the first pass; replace selected pieces with custom meshes later.
- Keep the script rerunnable by deleting only its own generated folder.
- Do not add external assets, toolbox models, paid assets, or network calls.
- Do not publish or modify a live Roblox experience from the generator.

## 6. Definition of done for v1 blockout

- Eight zones exist and are labelled.
- Main routes are continuous and easy to understand.
- Spawn-to-square and square-to-stadium routes are obvious.
- Stadium can be seen from the forecourt and central approach.
- Mini pitch has a playable flat surface and two goals.
- Static geometry is anchored and organised.
- A human playtest can walk the full loop without jumping over intended barriers.


## 8. Stadium detail pass (implemented in generator)

The current Roblox blockout generator now also includes:
- Repeated coloured seat blocks on all four stands, positioned on the pitch-facing side so they remain visible.
- A central scoreboard facing the field.
- Main-pitch goal frames and nets.
- Four exterior floodlight masts.
- Five forecourt gate arches with turnstile blocks.
- Planted islands and trees around Supporters' Square.

These are still primitive Parts, not final stadium assets. During the first Roblox Studio playtest, inspect whether the stand seating reads clearly from ground level and whether the entrance route feels wide enough for groups.

## 9. Next production tasks

1. Run the generator in a disposable Roblox Studio place.
2. Inspect scale, camera readability, collisions, and mobile navigation.
3. Adjust dimensions based on playtest evidence.
4. Add terrain/lighting/props and custom art direction.
5. Add the first interaction: mini-pitch penalty or ball-control activity.
6. Add social loops and event progression only after the space is validated.

## 10. Neighbourhood life pass (implemented in generator)

- Three additional fictional storefronts: Scarves & Flags, Matchday Diner, and Fan Workshop.
- Street-facing display windows, doors, and striped awnings.
- Café counter, menu board, indoor tables, chairs, and pendant lights.
- Café placeholder volume replaced by a four-wall shell with an open entrance so the interior can be seen and entered.
- Fictional matchday posters and a fan-culture wall graphic.
- A physics-enabled football placed on the Mini Pitch for the first hands-on Studio inspection.

This is still a greybox. Verify collision, the café entrance, ball physics, sign readability, and camera framing in Roblox Studio before treating the map as playable.

## 11. Supporter crowd and social landmarks (implemented prototype)

- Eight anchored supporter character stand-ins distributed across the social square, mini pitch, and stadium approach.
- Fictional scarf/cap colour combinations and short overhead greeting labels.
- Scarf display rack and three supporter flags near the Fan Shop.
- Three clearly marked meetup pads: square, mini pitch, and stadium approach.
- All NPC stand-ins are grouped under `Workspace.FootballFansMap.SocialLife` and are generated without external assets.

**Scope note:** these are static visual stand-ins only. They do not yet use Humanoid rigs, pathfinding, interactive dialogue, animated emotes, or player outfit selection. Those systems require a dedicated gameplay implementation and Studio playtest.

## 12. First social gameplay interactions (implemented prototype)

- Five interactive scarf displays use ProximityPrompt: Blue Crew, Orange Crew, Red Crew, Green Crew, and White Crew.
- Selecting a display assigns the matching Roblox Team and sets the player's `FanGroup` attribute.
- A simple two-part scarf visual is welded to the player's torso, and a colour-coded crew label appears above the character. Both are reapplied after respawn.
- Three meetup pads expose a `Cheer together` prompt. The server runtime briefly tweens the player's shoulder joints into a raised-arm cheer and restores the original joint offsets.
- A single `ServerScriptService.FootballFansSocialRuntime` script owns these interactions and is replaced safely when the map generator is rerun.

**Prototype limits:** selection is session-only (no DataStore), scarf geometry is deliberately simple, and the cheer is a joint-tween prototype rather than a polished animation. Test both R6 and R15 rigs, prompt visibility, team assignment, respawn, and animation conflicts in Roblox Studio before calling this feature complete.


## 13. Shared supporter banners (implemented prototype)

- Each of the three meetup pads has a `Raise crew banner` ProximityPrompt.
- A player must select a fan group before raising a banner.
- The first activation creates a simple anchored pole and cloth at the meetup spot; later activations recolour the existing banner and update its crew label.
- The banner is replicated by the server, so all players in that server see the current crew identity at that meetup spot.
- Each player has a short activation cooldown. The banner is session-only and is not persisted.

**Prototype limits:** one live banner per meetup spot; the latest valid activation determines its colour and label. This is not a personal inventory or a saved group asset. Validate multiplayer replication, prompt accessibility, banner orientation, and visual readability in Roblox Studio.


## 14. Supporter crews (implemented prototype)

- Each meetup pad offers `Create / join fan crew` and `Leave fan crew` prompts.
- Players must first select one of the five fan groups.
- The first player of a fan group creates a crew for the current server; other players of that same group can join.
- Each crew is limited to six members. The latest member does not replace the leader.
- Player attributes expose `FanCrewName`, `FanCrewLeader`, and `FanCrewSize` for a future roster UI.
- Members can leave at any meetup pad. If the leader leaves, leadership transfers to a remaining member.
- Membership is server-session-only and is cleared on PlayerRemoving.

**Prototype limits:** one active crew per fan group per server; no friend invitations, custom crew names, persistent membership, cross-server parties, chat channel, or progression rewards. Test multiplayer state consistency, capacity, leader handoff, and fan-group switching in Roblox Studio.

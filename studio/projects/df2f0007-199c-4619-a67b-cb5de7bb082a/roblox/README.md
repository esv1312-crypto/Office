# Roblox Football Fans District — MVP source

This folder contains the first playable source slice plus a visual-detail pass for the Football Fans District.

## Install in Roblox Studio

1. Create a new **Baseplate** experience in Roblox Studio.
2. In **ServerScriptService**, create a Script named `BuildDistrict.server.lua` and paste the matching file from this folder.
3. In **ServerScriptService**, create a second Script named `DetailPass.server.lua` and paste the matching file. It waits for the district builder and adds the art pass.
4. In **ServerScriptService**, create a third Script named `Gameplay.server.lua` and paste the matching file.
5. In **StarterPlayer → StarterPlayerScripts**, create a LocalScript named `HUD.client.lua` and paste the matching file.
6. Press **Play**. The builder creates the district; the detail pass adds shop facades, windows, street lamps, stadium floodlights, club banners, plaza sculpture, trees and benches.
7. Walk through the district and use **E** at the activity prompts to earn session XP. The HUD shows XP and level.

## Included

- Asset-free Roblox geometry built from native Parts.
- Central fan plaza and paths to the main areas.
- Stadium field, stand tiers, goal frames, stadium sign and night-match lighting.
- Home and away supporter zones.
- Fan Bar and Meeting Hall gathering hubs.
- Fan trivia and penalty-challenge reward prompts.
- Visual-detail pass: four multi-storey storefronts, glass displays, awnings, street lamps with lights, stadium floodlight towers, supporter banners, plaza football sculpture, trees and benches.
- Server-owned session XP and level progression.
- Client HUD for XP and level.

## Explicit limitations

- This source has **not** been run in Roblox Studio in this session.
- No `.rbxl` / `.rbxlx` place file has been exported.
- No live multiplayer playtest or performance test has been performed.
- XP is session-only; DataStore persistence is not yet wired.
- Roblox's built-in text filtering remains responsible for chat moderation; custom chat-zone enforcement is not implemented in this first slice.
- Trivia and penalty prompts are still reward placeholders, not finished skill-based minigames.
- The visual-detail pass uses native geometry and does not depend on external asset IDs.

This is an updated source package, not a published Roblox experience. Run it in Studio and verify the scene before publishing.

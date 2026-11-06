# Roblox Football Fans District — MVP source

This folder contains a first playable greybox source package assembled from the approved product direction and the first implementation pass.

## Install in Roblox Studio

1. Create a new **Baseplate** experience in Roblox Studio.
2. In **ServerScriptService**, create a Script named `BuildDistrict.server.lua` and paste the matching file from this folder.
3. In **ServerScriptService**, create a second Script named `Gameplay.server.lua` and paste the matching file.
4. In **StarterPlayer → StarterPlayerScripts**, create a LocalScript named `HUD.client.lua` and paste the matching file.
5. Press **Play**. The server builder creates the fan plaza, stadium greybox, home/away supporter zones, fan bar, meeting hall, kiosks, and spawn point.
6. Walk through the district and use **E** at the activity prompts to earn session XP. The HUD shows XP and level.

## Included in this first slice

- Asset-free greybox geometry built from native Roblox Parts.
- Central fan plaza and paths to the main areas.
- Stadium field, simple stand tiers, goal frames, scoreboard sign, and night-match lighting.
- Home and away supporter zones.
- Two gathering hubs: Fan Bar and Meeting Hall.
- Fan trivia and penalty-challenge interaction kiosks (simple XP reward placeholders).
- Server-owned session XP and level progression.
- Client HUD for XP and level.

## Explicit limitations

- This source has **not** been run in Roblox Studio in this session.
- No `.rbxl` / `.rbxlx` place file has been exported.
- No live multiplayer playtest or performance test has been performed.
- XP is session-only; DataStore persistence is not yet wired.
- Roblox's built-in text filtering remains responsible for chat moderation; custom chat-zone enforcement is not implemented in this first slice.
- The trivia and penalty kiosks are reward placeholders, not finished skill-based minigames.
- The district uses native geometry and no external asset IDs.

This is a source-level MVP starter, not a published Roblox experience. Run it in Studio and verify the scene before publishing.

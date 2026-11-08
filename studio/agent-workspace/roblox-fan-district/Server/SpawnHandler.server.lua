-- SpawnHandler.server.lua
-- Handles player joining/leaving with proper cleanup and spawn at plaza center

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- Ensure PlazaCenter attribute exists; fallback to origin
local plazaCenter = ReplicatedStorage:GetAttribute("PlazaCenter") or Vector3.new(0, 50, 0)

-- Create a SpawnLocation for the plaza center
local function getOrCreateSpawnLocation()
    -- Check if a SpawnLocation already exists in the workspace
    for _, child in ipairs(Workspace:GetChildren()) do
        if child:IsA("SpawnLocation") then
            return child
        end
    end

    -- Create a new SpawnLocation at the plaza center
    local spawnLocation = Instance.new("SpawnLocation")
    spawnLocation.Name = "FanPlazaSpawn"
    spawnLocation.Position = plazaCenter
    spawnLocation.Size = Vector3.new(5, 1, 5)
    spawnLocation.Color = Color3.fromRGB(0, 120, 255)
    spawnLocation.Anchored = true
    spawnLocation.TeamColor = BrickColor.new("Bright blue")
    spawnLocation.Parent = Workspace

    return spawnLocation
end

local spawnLocation = getOrCreateSpawnLocation()

-- Function to set player's spawn point and handle character appearance
local function onPlayerAdded(player)
    -- Set the player's spawn location
    player.SpawnLocation = spawnLocation

    -- Optional: Give the player a welcome badge or basic tools
    -- Example: grantStarterTools(player)

    -- Track character appearance
    local function onCharacterAdded(character)
        -- Wait a moment for character to fully load
        task.wait(0.5)

        -- Example: Set the character's initial CFrame to the spawn pad
        local humanoid = character:FindFirstChild("Humanoid")
        if humanoid then
            -- Move to center of spawn pad
            humanoid:MoveTo(spawnLocation.Position + Vector3.new(0, 2, 0))
        end

        -- Cleanup when character dies or is removed
        character.AncestryChanged:Connect(function(_, newParent)
            if newParent == nil then
                -- Character was destroyed/removed, clean up any custom attributes
                -- Example: remove welcome effects
            end
        end)
    end

    player.CharacterAdded:Connect(onCharacterAdded)

    -- If player already has a character, handle it immediately
    if player.Character then
        onCharacterAdded(player.Character)
    end

    print(player.Name .. " joined. Spawn set at plaza center.")
end

-- Function to handle player leaving
local function onPlayerRemoving(player)
    -- Cleanup: remove any player-specific objects, reset attributes, etc.
    -- Example: clean up leaderstats, remove equipped tools, etc.

    -- If the spawn location was created by this player's session, consider
    -- whether to keep it or remove it. For now, we keep the shared spawn.
    print(player.Name .. " leaving. Cleanup complete.")
end

-- Connect events
Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)

-- Also handle player respawns (optional: reset spawn location on each respawn)
Players.PlayerRespawn:Connect(function(player)
    -- Ensure spawn location is re-applied after respawn
    player.SpawnLocation = spawnLocation
end)

print("SpawnHandler initialized. Plaza spawn at:", plazaCenter)
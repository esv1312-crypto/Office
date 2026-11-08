-- Server/SpawnHandler.lua
-- Handles player joining/leaving and character spawning at the fan plaza.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local SpawnHandler = {}

-- Track active player sessions for cleanup
local activePlayers = {}

function SpawnHandler.onPlayerAdded(player)
	-- Store player session data
	activePlayers[player.UserId] = {
		player = player,
		character = nil,
		connections = {},
	}

	-- Listen for character added
	local characterConnection = player.CharacterAdded:Connect(function(character)
		activePlayers[player.UserId].character = character

		-- Move character to plaza spawn if a spawn location exists
		local spawn = Workspace:FindFirstChild("PlazaSpawn")
		if spawn and character:FindFirstChild("HumanoidRootPart") then
			character.HumanoidRootPart.CFrame = spawn.CFrame + Vector3.new(0, 3, 0)
		end
	end)

	-- Listen for character removed
	local characterRemovedConnection = player.CharacterRemoving:Connect(function()
		activePlayers[player.UserId].character = nil
	end)

	activePlayers[player.UserId].connections.characterAdded = characterConnection
	activePlayers[player.UserId].connections.characterRemoving = characterRemovedConnection

	print(string.format("Player joined: %s (UserId: %d)", player.Name, player.UserId))
end

function SpawnHandler.onPlayerRemoving(player)
	local session = activePlayers[player.UserId]
	if session then
		-- Disconnect all tracked connections
		for _, connection in pairs(session.connections) do
			if connection and connection.Connected then
				connection:Disconnect()
			end
		end

		-- Clear character reference
		session.character = nil

		-- Remove session from tracking
		activePlayers[player.UserId] = nil
	end

	print(string.format("Player left: %s (UserId: %d)", player.Name, player.UserId))
end

function SpawnHandler.start()
	-- Connect to existing players (in case script reloads)
	for _, player in ipairs(Players:GetPlayers()) do
		SpawnHandler.onPlayerAdded(player)
	end

	Players.PlayerAdded:Connect(SpawnHandler.onPlayerAdded)
	Players.PlayerRemoving:Connect(SpawnHandler.onPlayerRemoving)

	print("SpawnHandler started.")
end

-- Start the handler
SpawnHandler.start()

return SpawnHandler
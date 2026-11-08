--[[
	Fan Plaza Spawn System
	Handles player joining/leaving with proper cleanup and spawn management
	Location: ServerScriptService.SpawnSystem
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

-- Configuration
local SPAWN_CONFIG = {
	spawnPosition = Vector3.new(0, 5, 0), -- Center of plaza, slightly above ground
	spawnRadius = 10, -- Random spawn within this radius
	cleanupDelay = 2, -- Seconds before cleaning up character on leave
}

-- State
local activeCharacters = {} -- [player] = character
local spawnConnections = {} -- [player] = {connections}

-- Utility: Get or create the spawn location part
local function getOrCreateSpawnLocation()
	local spawnLocation = Workspace:FindFirstChild("FanPlazaSpawnLocation")
	if not spawnLocation then
		spawnLocation = Instance.new("SpawnLocation")
		spawnLocation.Name = "FanPlazaSpawnLocation"
		spawnLocation.Position = SPAWN_CONFIG.spawnPosition
		spawnLocation.Size = Vector3.new(12, 1, 12)
		spawnLocation.Anchored = true
		spawnLocation.CanCollide = false
		spawnLocation.Transparency = 1
		spawnLocation.Neutral = true
		spawnLocation.AllowTeamChangeOnTouch = false
		spawnLocation.Duration = 0
		spawnLocation.Parent = Workspace
		
		-- Add a visual indicator (optional)
		local indicator = Instance.new("Part")
		indicator.Name = "SpawnIndicator"
		indicator.Shape = Enum.PartType.Cylinder
		indicator.Size = Vector3.new(0.5, 14, 14)
		indicator.Position = SPAWN_CONFIG.spawnPosition + Vector3.new(0, 0.25, 0)
		indicator.Anchored = true
		indicator.CanCollide = false
		indicator.Transparency = 0.8
		indicator.BrickColor = BrickColor.new("Bright blue")
		indicator.Material = Enum.Material.Neon
		indicator.Parent = Workspace
		indicator.Name = "FanPlazaSpawnIndicator"
	end
	return spawnLocation
end

-- Utility: Get a random spawn position within the plaza
local function getRandomSpawnPosition()
	local angle = math.random() * math.pi * 2
	local radius = math.random() * SPAWN_CONFIG.spawnRadius
	local offset = Vector3.new(
		math.cos(angle) * radius,
		3, -- Height above ground
		math.sin(angle) * radius
	)
	return SPAWN_CONFIG.spawnPosition + offset
end

-- Clean up a player's character and connections
local function cleanupPlayer(player)
	-- Disconnect any connections
	if spawnConnections[player] then
		for _, connection in ipairs(spawnConnections[player]) do
			connection:Disconnect()
		end
		spawnConnections[player] = nil
	end
	
	-- Clean up character reference
	activeCharacters[player] = nil
end

-- Handle character added
local function onCharacterAdded(player, character)
	activeCharacters[player] = character
	
	-- Set up character cleanup on death/removal
	local humanoid = character:WaitForChild("Humanoid", 5)
	if humanoid then
		local diedConnection
		diedConnection = humanoid.Died:Connect(function()
			-- Character died, will respawn automatically via SpawnLocation
			if diedConnection then
				diedConnection:Disconnect()
			end
		end)
		table.insert(spawnConnections[player] or {}, diedConnection)
	end
	
	-- Ensure character spawns at plaza center on first spawn
	local rootPart = character:WaitForChild("HumanoidRootPart", 5)
	if rootPart and not character:GetAttribute("HasSpawnedAtPlaza") then
		character:SetAttribute("HasSpawnedAtPlaza", true)
		local spawnPos = getRandomSpawnPosition()
		rootPart.CFrame = CFrame.new(spawnPos)
	end
end

-- Handle character removing
local function onCharacterRemoving(player, character)
	-- Delay cleanup to allow for respawn
	task.delay(SPAWN_CONFIG.cleanupDelay, function()
		if activeCharacters[player] == character then
			cleanupPlayer(player)
		end
	end)
end

-- Handle player joining
local function onPlayerAdded(player)
	spawnConnections[player] = {}
	
	-- Connect character events
	local charAddedConn = player.CharacterAdded:Connect(function(character)
		onCharacterAdded(player, character)
	end)
	table.insert(spawnConnections[player], charAddedConn)
	
	local charRemovingConn = player.CharacterRemoving:Connect(function(character)
		onCharacterRemoving(player, character)
	end)
	table.insert(spawnConnections[player], charRemovingConn)
	
	-- If player already has a character (edge case)
	if player.Character then
		onCharacterAdded(player, player.Character)
	end
end

-- Handle player leaving
local function onPlayerRemoving(player)
	cleanupPlayer(player)
end

-- Initialize the spawn system
local function initialize()
	-- Create the spawn location
	getOrCreateSpawnLocation()
	
	-- Connect player events
	Players.PlayerAdded:Connect(onPlayerAdded)
	Players.PlayerRemoving:Connect(onPlayerRemoving)
	
	-- Handle players already in game (for testing in Studio)
	for _, player in ipairs(Players:GetPlayers()) do
		onPlayerAdded(player)
	end
	
	print("[FanPlaza] Spawn system initialized")
end

-- Start the system
initialize()

-- Export for potential external access
return {
	SPAWN_CONFIG = SPAWN_CONFIG,
	getRandomSpawnPosition = getRandomSpawnPosition,
}
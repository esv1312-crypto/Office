--[[
	Player Setup Script
	Handles basic character setup and initial configuration
	Location: StarterPlayerScripts.PlayerSetup
]]

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Workspace = game:GetService("Workspace")

-- Configuration
local PLAYER_CONFIG = {
	maxHealth = 100,
	walkSpeed = 16,
	jumpPower = 50,
	respawnTime = 3,
}

-- Handle player joining
local function onPlayerAdded(player)
	-- Set player name tag
	player.NameDisplayDistance = 20
	player.NameDisplayMode = Enum.NameDisplayMode.AlwaysOnTop
	
	-- Set initial character appearance (if available)
	local character = player.Character
	if character then
		onCharacterAdded(player, character)
	end
end

-- Handle player leaving
local function onPlayerRemoving(player)
	-- Clean up any player-specific data
	print("[PlayerSetup] Player " .. player.Name .. " leaving")
end

-- Handle character added
local function onCharacterAdded(player, character)
	-- Set character attributes
	character:SetAttribute("MaxHealth", PLAYER_CONFIG.maxHealth)
	character:SetAttribute("CurrentHealth", PLAYER_CONFIG.maxHealth)
		
	-- Configure humanoid
	local humanoid = character:FindFirstChild("Humanoid")
	if humanoid then
		humanoid.MaxHealth = PLAYER_CONFIG.maxHealth
		humanoid.Health = PLAYER_CONFIG.maxHealth
		humanoid.WalkSpeed = PLAYER_CONFIG.walkSpeed
		humanoid.JumpPower = PLAYER_CONFIG.jumpPower
		
		-- Connect health changed event
		humanoid.HealthChanged:Connect(function(newHealth)
			character:SetAttribute("CurrentHealth", newHealth)
			if newHealth <= 0 then
				-- Character died, respawn after delay
				task.delay(PLAYER_CONFIG.respawnTime, function()
					if player.Character and player.Character:FindFirstChild("Humanoid") then
						player.Character.Humanoid.Health = PLAYER_CONFIG.maxHealth
				end
				end)
			end
		end)
	end
	
	-- Configure root part
	local rootPart = character:FindFirstChild("HumanoidRootPart")
	if rootPart then
		-- Ensure root part is properly initialized
		rootPart.Anchored = false
		rootPart.CanCollide = true
		
		-- Add a marker to identify this as a player character
		rootPart.Name = "HumanoidRootPart"
	end
	
	print("[PlayerSetup] Character setup complete for " .. player.Name)
end

-- Handle character removing
local function onCharacterRemoving(player, character)
	-- Clean up character-specific data
	print("[PlayerSetup] Character removing for " .. player.Name)
end

-- Initialize the player setup system
local function initialize()
	-- Connect player events
	Players.PlayerAdded:Connect(onPlayerAdded)
	Players.PlayerRemoving:Connect(onPlayerRemoving)
	
	-- Handle existing players (for testing in Studio)
	for _, player in ipairs(Players:GetPlayers()) do
		onPlayerAdded(player)
		
		-- If player already has a character, set it up
		if player.Character then
			onCharacterAdded(player, player.Character)
		end
	end
	
	print("[PlayerSetup] Player setup system initialized")
end

-- Start the system
initialize()

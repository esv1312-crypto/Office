--!strict
-- ChallengeManager.server.lua
-- Server-side logic for the Repeatable Challenge Mechanic.
-- Handles starting, tracking, resetting, and validating challenges for players.

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

-- Load shared remote definitions
local ChallengeRemotes = require(ReplicatedStorage:WaitForChild("ChallengeRemotes"))

-- Configuration for the default challenge type
-- "CHEER" - player must cheer (play emote) for a duration
-- "COLLECT" - player must collect a number of items
type ChallengeType = "CHEER" | "COLLECT"

-- Default challenge configuration
local DefaultChallengeConfig = {
	[ChallengeType.CHEER] = {
		Name = "Cheer for 3 Seconds",
		Duration = 3, -- seconds
		Description = "Play the cheering emote and hold it for 3 seconds.",
	},
	[ChallengeType.COLLECT] = {
		Name = "Collect 5 Items",
		TargetCount = 5,
		Description = "Touch 5 collectible parts.",
	},
}

-- Player challenge state storage
-- Key: Player.Instance, Value: ChallengeState?
type PlayerChallengeState = {
	-- The type of challenge currently active
	Type: ChallengeType,
	-- Remaining time/count to complete
	Remaining: number,
	-- Whether the challenge is currently in progress
	IsActive: boolean,
	-- Start time in seconds (for time-based challenges)
	StartTime: number,
	-- Count collected (for count-based challenges)
	CountCollected: number,
}

-- Store: { [player: Player] -> PlayerChallengeState? }
local playerChallenges: { [Player]: PlayerChallengeState } = {}

-- Helper: get or create a player's challenge state, returns nil if no active challenge
local function getPlayerState(player: Player): PlayerChallengeState?
	return playerChallenges[player]
end

-- Helper: check if player already has an active challenge
local function hasActiveChallenge(player: Player): boolean
	local state = playerChallenges[player]
	return state ~= nil and state.IsActive == true
end

-- Helper: fire the state changed remote to all clients (or specific player)
local function fireStateChanged(player: Player?, state: PlayerChallengeState)
	local remote = ChallengeRemotes.ChallengeStateChanged
	if not remote then
		warn("ChallengeStateChanged remote not found")
		return
	end
	if player then
		remote:FireClient(player)
	else
		-- Fire to all clients; receiver can filter by player if needed
		remote:FireAllClients()
	end
end

-- Helper: fire the result remote to the player
local function fireResult(player: Player, success: boolean, challengeName: string)
	local remote = ChallengeRemotes.ChallengeResult
	if not remote then
		warn("ChallengeResult remote not found")
		return
	end
	remote:FireClient(player, success, challengeName)
end

-- -------------------------------------------------------------------------
-- Server: Start a challenge for a player
-- -------------------------------------------------------------------------
-- @param player The player to start the challenge for
-- @param challengeType The type of challenge ("CHEER" or "COLLECT")
-- @param durationOrTarget optional duration (seconds) or target count
-- @return success boolean, message string
function ChallengeManager.startChallenge(player: Player, challengeType: ChallengeType, durationOrTarget: any): boolean, string
	if hasActiveChallenge(player) then
		return false, "Player already has an active challenge."
	end

	local config = DefaultChallengeConfig[challengeType]
	if not config then
		return false, "Unknown challenge type: " .. tostring(challengeType)
	end

	-- Apply defaults if not provided
	local effectiveDuration: number
	local effectiveTarget: number

	if challengeType == ChallengeType.CHEER then
		effectiveDuration = if durationOrTarget then if typeof(durationOrTarget) == "number" and durationOrTarget > 0 then durationOrTarget else (config.Duration :: number) end else config.Duration
		effectiveTarget = nil
	elseif challengeType == ChallengeType.COLLECT then
		effectiveTarget = if durationOrTarget then if typeof(durationOrTarget) == "number" and durationOrTarget > 0 then durationOrTarget else (config.TargetCount :: number) end else (config.TargetCount :: number)
		effectiveDuration = nil
	end

	local state: PlayerChallengeState = {
		Type = challengeType,
		Remaining = if effectiveDuration then effectiveDuration else effectiveTarget,
		IsActive = true,
		StartTime = if effectiveDuration then tick() else 0,
		CountCollected = 0,
	}

	playerChallenges[player] = state

	-- Notify clients
	fireStateChanged(player, state)

	-- Automatically reset after duration expires (for time-based challenges)
	if effectiveDuration and effectiveDuration > 0 then
		task.delay(effectiveDuration, function()
			-- Check if the challenge is still active and not manually reset
			local currentState = playerChallenges[player]
			if currentState and currentState.IsActive then
				-- Mark as failed (timed out)
				currentState.IsActive = false
				fireStateChanged(player, currentState)
				fireResult(player, false, config.Name)
				-- Clean up state after a brief moment
				task.wait(0.5)
				playerChallenges[player] = nil
			end
		end)
	end

	return true, "Challenge started: " .. config.Name
end

-- -------------------------------------------------------------------------
-- Server: Reset/ cancel a player's current challenge
-- -------------------------------------------------------------------------
-- Can be called by the player or server logic
-- @param player The player whose challenge to reset
-- @param cancelIfActive if true, the challenge is cancelled (inactive). if false, state is preserved but marked inactive.
function ChallengeManager.resetChallenge(player: Player, cancelIfActive: boolean): boolean, string
	local state = playerChallenges[player]
	if not state then
		return false, "No active challenge found for this player."
	end

	if not cancelIfActive then
		-- Optionally could just mark inactive but keep data; for simplicity we'll fully reset.
		-- Here we fully reset as per typical "reset" semantics.
	end

	state.IsActive = false
	fireStateChanged(player, state)

	-- Remove state after brief notification
	task.wait(0.5)
	playerChallenges[player] = nil

	return true, "Challenge reset for " .. player.Name
end

-- -------------------------------------------------------------------------
-- Remote event handlers
-- -------------------------------------------------------------------------

-- Client -> Server: Request to start a challenge
ChallengeRemotes.StartChallenge.OnServerEvent:Connect(function(player: Player, challengeType: string, durationOrTarget: any)
	-- Validate challenge type
	local successType, err = pcall(function()
		if challengeType ~= "CHEER" and challengeType ~= "COLLECT" then
			error("Invalid challenge type")
		end
	end)
	if not successType then
		warn("Invalid challenge type from " .. player.Name .. ": " .. tostring(challengeType))
		return
	end

	local success, message = ChallengeManager.startChallenge(player, challengeType, durationOrTarget)
	-- Optionally send a response back to the client if needed
	-- For now we just log; the state change remote will notify them.
end)

-- Client -> Server: Request to reset the current challenge
ChallengeRemotes.ResetChallenge.OnServerEvent:Connect(function(player: Player)
	local success, message = ChallengeManager.resetChallenge(player, true)
	-- Could fire a result remote here if desired
end)

-- -------------------------------------------------------------------------
-- Game logic: Cheer detection (emote played)
-- -------------------------------------------------------------------------
-- This listens for players playing the "Cheer" emote (or any emote we treat as cheering).
-- We'll use the BuiltIn emote "Cheer" which fires when a player starts playing it.
Players.PlayerAdded:Connect(function(player: Player)
	-- Track when a player starts an emote that could count toward a CHEER challenge
	local function onEmoteTriggered(character: Model, emoteName: string)
		if not playerChallenges[player] then return end
		local state = playerChallenges[player]
		if state.Type ~= ChallengeType.CHEER then return end
		if not state.IsActive then return end

		-- If the emote is "Cheer" (case-insensitive), count it
		if string.lower(emoteName) == "cheer" then
			-- For a time-based challenge, we rely on the automatic timeout above.
			-- We could also reset the timer each time the emote is played to extend.
			-- For simplicity, we just rely on the server-side timer.
			-- Optionally, we could fire a client update, but the timer handles it.
		end
	end

	-- Humanoid has an EmoteTriggered event (Roblox internal)
	local humanoid = player.Character and player.Character:FindFirstChild("Humanoid")
	if humanoid then
		humanoid.EmoteTriggered:Connect(function(emoteName: string)
			onEmoteTriggered(character or player.Character, emoteName)
		end)
	end

	-- Also listen for character appearance
	player.CharacterAdded:Connect(function(character: Model)
		local humanoid = character:FindFirstChild("Humanoid")
		if humanoid then
			humanoid.EmoteTriggered:Connect(function(emoteName: string)
				onEmoteTriggered(character, emoteName)
			end)
		end
	end
end)

-- -------------------------------------------------------------------------
-- Game logic: Collectible detection
-- -------------------------------------------------------------------------
-- Example collectible part should have a tag or be in a folder we monitor.
-- Here we simply detect when a player's Touched event hits a part tagged "Collectible".

local function setupCollectibleTracking(player: Player)
	if not playerChallenges[player] then return end
	local state = playerChallenges[player]
	if state.Type ~= ChallengeType.COLLECT then return end
	if not state.IsActive then return end

	-- We'll track the player's character and its parts
	player.CharacterAdded:Connect(function(character: Model)
		-- Search for parts tagged "Collectible" in the Workspace that could be touched.
		-- For this demo, we'll monitor Touched on the character's parts.
		local function onTouched(hit: BasePart)
			-- Check if the hit part has our collectible tag
			if hit:GetAttribute("IsCollectible") then
				-- Validate the hit is from a collectible we placed (simple check: part must be in Workspace and have the attribute)
				state.CountCollected = (state.CountCollected :: number) + 1
				hit:SetAttribute("TouchedCount", (hit:GetAttribute("TouchedCount") or 0) + 1)

				-- Update state remote
				fireStateChanged(player, state)

				-- Check if target reached
				if state.CountCollected >= (state.Remaining :: number) then
					-- Challenge completed successfully
					state.IsActive = false
					fireStateChanged(player, state)
					fireResult(player, true, "Collect 5 Items")
					-- Clean up
					task.wait(0.5)
					playerChallenges[player] = nil
				end
			end
		end

		-- Attach Touched to each Part in the character (non-anchored, can be touched)
		for _, part: BasePart in ipairs(character:GetDescendants()) do
			if part:IsA("BasePart") and not part.Anchored then
				part.Touched:Connect(onTouched)
			end
		end
	end)
end

-- When a player joins, if they have an existing challenge state (e.g., from data persistence), we'd load it.
-- For this implementation, we start fresh per session.

-- -------------------------------------------------------------------------
-- Initialize: assign challenge manager globals for easy access
-- -------------------------------------------------------------------------

-- Expose the manager functions via ReplicatedStorage for potential remote administration
local ChallengeManagerExported = {}
ChallengeManagerExported.startChallenge = ChallengeManager.startChallenge
ChallengeManagerExported.resetChallenge = ChallengeManager.resetChallenge
ChallengeManagerExported.getPlayerState = getPlayerState

return ChallengeManagerExported
-- Server-Authoritative Points System
-- Handles player points, rate limiting, and RemoteEvent processing

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

-- Configuration
local CONFIG = {
	CHEER_POINTS = 10,
	COLLECT_ITEM_POINTS = 25,
	MAX_CHEERS_PER_MINUTE = 30,
	MAX_COLLECTS_PER_MINUTE = 10,
	MAX_REMOTE_CALLS_PER_SECOND = 5,
}

-- RemoteEvents
local remoteEvents = Instance.new("Folder")
remoteEvents.Name = "PointsRemotes"
remoteEvents.Parent = ReplicatedStorage

local cheerRemote = Instance.new("RemoteEvent")
cheerRemote.Name = "Cheer"
cheerRemote.Parent = remoteEvents

local collectItemRemote = Instance.new("RemoteEvent")
collectItemRemote.Name = "CollectItem"
collectItemRemote.Parent = remoteEvents

local getPointsRemote = Instance.new("RemoteFunction")
getPointsRemote.Name = "GetPoints"
getPointsRemote.Parent = remoteEvents

-- Player data storage
local playerPoints = {} -- [userId] = points
local playerRateLimits = {} -- [userId] = {cheer = {timestamps}, collect = {timestamps}, general = {timestamps}}

-- Utility: Clean old timestamps (older than 60 seconds)
local function cleanOldTimestamps(timestamps, maxAge)
	local now = os.clock()
	local cleaned = {}
	for _, ts in ipairs(timestamps) do
		if now - ts < maxAge then
			table.insert(cleaned, ts)
		end
	end
	return cleaned
end

-- Rate limiting check
local function checkRateLimit(player, actionType, maxPerWindow, windowSeconds)
	local userId = player.UserId
	if not playerRateLimits[userId] then
		playerRateLimits[userId] = {cheer = {}, collect = {}, general = {}}
	end
	
	local timestamps = playerRateLimits[userId][actionType]
	if not timestamps then
		timestamps = {}
		playerRateLimits[userId][actionType] = timestamps
	end
	
	-- Clean old entries
	timestamps = cleanOldTimestamps(timestamps, windowSeconds)
	playerRateLimits[userId][actionType] = timestamps
	
	-- Check general rate limit (per second)
	local generalTimestamps = playerRateLimits[userId].general
	generalTimestamps = cleanOldTimestamps(generalTimestamps, 1)
	playerRateLimits[userId].general = generalTimestamps
	
	if #generalTimestamps >= CONFIG.MAX_REMOTE_CALLS_PER_SECOND then
		return false, "Rate limit exceeded: too many requests per second"
	end
	
	-- Check action-specific rate limit
	if #timestamps >= maxPerWindow then
		return false, string.format("Rate limit exceeded: max %d %s per %d seconds", maxPerWindow, actionType, windowSeconds)
	end
	
	-- Add current timestamp
	table.insert(timestamps, os.clock())
	table.insert(generalTimestamps, os.clock())
	
	return true, nil
end

-- Initialize player data
local function initPlayer(player)
	local userId = player.UserId
	if not playerPoints[userId] then
		playerPoints[userId] = 0
	end
	if not playerRateLimits[userId] then
		playerRateLimits[userId] = {cheer = {}, collect = {}, general = {}}
	end
end

-- Get player points (server-side only)
local function getPoints(player)
	local userId = player.UserId
	return playerPoints[userId] or 0
end

-- Add points (server-side only)
local function addPoints(player, amount)
	local userId = player.UserId
	playerPoints[userId] = (playerPoints[userId] or 0) + amount
	return playerPoints[userId]
end

-- Remove points (server-side only)
local function removePoints(player, amount)
	local userId = player.UserId
	playerPoints[userId] = math.max(0, (playerPoints[userId] or 0) - amount)
	return playerPoints[userId]
end

-- Handle Cheer RemoteEvent
cheerRemote.OnServerEvent:Connect(function(player)
	-- Validate player
	if not player or not player:IsA("Player") then
		return
	end
	
	-- Rate limiting: max 30 cheers per minute
	local allowed, err = checkRateLimit(player, "cheer", CONFIG.MAX_CHEERS_PER_MINUTE, 60)
	if not allowed then
		warn(string.format("[PointsSystem] Player %s cheer rate limited: %s", player.Name, err))
		return
	end
	
	-- Award points server-side
	local newTotal = addPoints(player, CONFIG.CHEER_POINTS)
	print(string.format("[PointsSystem] Player %s cheered! +%d points (Total: %d)", player.Name, CONFIG.CHEER_POINTS, newTotal))
	
	-- Fire client with updated points (optional, for UI update)
	cheerRemote:FireClient(player, newTotal)
end)

-- Handle CollectItem RemoteEvent
collectItemRemote.OnServerEvent:Connect(function(player, itemId)
	-- Validate player
	if not player or not player:IsA("Player") then
		return
	end
	
	-- Validate itemId (basic validation)
	if not itemId or type(itemId) ~= "string" then
		warn(string.format("[PointsSystem] Player %s sent invalid itemId", player.Name))
		return
	end
	
	-- Rate limiting: max 10 collects per minute
	local allowed, err = checkRateLimit(player, "collect", CONFIG.MAX_COLLECTS_PER_MINUTE, 60)
	if not allowed then
		warn(string.format("[PointsSystem] Player %s collect rate limited: %s", player.Name, err))
		return
	end
	
	-- Award points server-side (could vary by item type in future)
	local newTotal = addPoints(player, CONFIG.COLLECT_ITEM_POINTS)
	print(string.format("[PointsSystem] Player %s collected item %s! +%d points (Total: %d)", player.Name, itemId, CONFIG.COLLECT_ITEM_POINTS, newTotal))
	
	-- Fire client with updated points
	collectItemRemote:FireClient(player, newTotal, itemId)
end)

-- Handle GetPoints RemoteFunction (for client to query current points)
getPointsRemote.OnServerInvoke = function(player)
	if not player or not player:IsA("Player") then
		return 0
	end
	return getPoints(player)
end

-- Player lifecycle
Players.PlayerAdded:Connect(function(player)
	initPlayer(player)
	print(string.format("[PointsSystem] Player %s joined. Points initialized.", player.Name))
end)

Players.PlayerRemoving:Connect(function(player)
	local userId = player.UserId
	-- Clean up rate limit data (keep points for persistence across sessions if needed)
	playerRateLimits[userId] = nil
	print(string.format("[PointsSystem] Player %s left. Rate limit data cleaned.", player.Name))
end)

-- Admin command for testing (optional)
local function onChatCommand(player, message)
	if message:sub(1, 7) == "/points" then
		local parts = message:split(" ")
		if #parts == 2 and parts[2] == "reset" then
			-- Only allow if player has admin permissions (simplified check)
			if player:GetRankInGroup(0) >= 255 then -- Placeholder for admin check
				playerPoints[player.UserId] = 0
				print(string.format("[PointsSystem] Admin %s reset points for %s", player.Name, player.Name))
			end
		elseif #parts == 1 then
			local pts = getPoints(player)
			print(string.format("[PointsSystem] %s has %d points", player.Name, pts))
		end
	end
end

Players.PlayerAdded:Connect(function(player)
	player.Chatted:Connect(function(message)
		onChatCommand(player, message)
	end)
end)

print("[PointsSystem] Server-authoritative points system initialized")
print(string.format("[PointsSystem] Config: Cheer=%dpts, Collect=%dpts, CheerRate=%d/min, CollectRate=%d/min", 
	CONFIG.CHEER_POINTS, CONFIG.COLLECT_ITEM_POINTS, CONFIG.MAX_CHEERS_PER_MINUTE, CONFIG.MAX_COLLECTS_PER_MINUTE))
-- Server-Authoritative Points System
-- Handles player points, rate limiting, and RemoteEvent processing

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")

-- Configuration
local CONFIG = {
	CHEER_POINTS = 10,
	COLLECT_ITEM_POINTS = 25,
	MAX_CHEERS_PER_MINUTE = 30,
	MAX_COLLECTS_PER_MINUTE = 10,
	MAX_REMOTE_CALLS_PER_SECOND = 5,
}

-- DataStore name for persisting points and rate-limit metadata per player
local DATA_STORE_NAME = "PointsSystem"

-- RemoteEvents / RemoteFunction hierarchy under ReplicatedStorage -> PointsRemotes
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

-- Player data storage (in-memory for rate limits, persisted for points)
local playerPoints = {}   -- [userId] = total points
local playerRateLimits = {} -- [userId] = {cheer={...}, collect={...}, general={...}}
local playerData = {}     -- temporary map for cleanup during removals

-- Utility: Clean old timestamps (keep entries older than maxAge seconds)
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

	local timestamps = cleanOldTimestamps(timestamps, windowSeconds)
	playerRateLimits[userId][actionType] = timestamps

	local generalTimestamps = playerRateLimits[userId].general
	generalTimestamps = cleanOldTimestamps(generalTimestamps, 1)
	playerRateLimits[userId].general = generalTimestamps

	if #generalTimestamps >= CONFIG.MAX_REMOTE_CALLS_PER_SECOND then
		return false, "Rate limit exceeded: too many requests per second"
	end

	if #timestamps >= maxPerWindow then
		return false, string.format("Rate limit exceeded: max %d %s per %d seconds", maxPerWindow, actionType, windowSeconds)
	end

	table.insert(timestamps, os.clock())
	table.insert(generalTimestamps, os.clock())

	return true, nil
end

-- Initialize player data (points + rate limits) and persist points to DataStore
local function initPlayer(player)
	local userId = player.UserId

	-- Load previously saved points (if any)
	local savedPointsStr = DataStoreService:GetString(DATA_STORE_NAME, userId)
	local savedPoints = tonumber(savedPointsStr) or 0
	playerPoints[userId] = savedPoints

	-- Initialize rate-limit structures for this user
	playerRateLimits[userId] = {cheer = {}, collect = {}, general = {}}
	playerData[userId] = {}

	-- Persist points to DataStore
	local ok, pointsStr = pcall(function()
		DataStoreService:SetString(DATA_STORE_NAME, userId, tostring(playerPoints[userId]))
	end)
	if ok then
		playerPoints[userId] = tonumber(pointsStr) -- ensure numeric
	end

	-- Persist rate-limit timestamp sets (last 60 s for general, 60 s for specific actions)
	for act in {"cheer", "collect", "general"} do
		local tsList = cleanOldTimestamps(playerRateLimits[userId][act], 60)
		local tsJson = {act = act, timestamps = table.concat({tostring(os.clock())})}
		-- Store as JSON string
		DataStoreService:SetString(DATA_STORE_NAME .. "_ratelimit_" .. act, tostring(tsJson))
	end
end

-- Remove player data and clear DataStore entries on removal
local function removePlayerData(player)
	local userId = player.UserId
	playerPoints[userId] = nil
	playerRateLimits[userId] = nil
	playerData[userId] = nil

	-- Clear DataStore entries
	DataStoreService:DeleteString(DATA_STORE_NAME, userId)
	DataStoreService:DeleteString(DATA_STORE_NAME .. "_ratelimit_cheer", userId)
	DataStoreService:DeleteString(DATA_STORE_NAME .. "_ratelimit_collect", userId)
	DataStoreService:DeleteString(DATA_STORE_NAME .. "_ratelimit_general", userId)
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
	if not player or type(player) ~= "Player" then return end

	-- Rate limiting: max 30 cheers per minute
	local allowed, err = checkRateLimit(player, "cheer", CONFIG.MAX_CHEERS_PER_MINUTE, 60)
	if not allowed then
		warn(string.format("[PointsSystem] Player %s cheer rate limited: %s", player.Name, err))
		return end

	-- Award points server-side
	local newTotal = addPoints(player, CONFIG.CHEER_POINTS)
	print(string.format("[PointsSystem] Player %s cheered! +%d points (Total: %d)", player.Name, CONFIG.CHEER_POINTS, newTotal))

	-- Fire client update (optional)
	cheerRemote:FireClient(player, newTotal)
end)

-- Handle CollectItem RemoteEvent
collectItemRemote.OnServerEvent:Connect(function(player, itemId)
	-- Validate player
	if not player or type(player) ~= "Player" then return end

	-- Validate itemId (basic validation)
	if not itemId or type(itemId) ~= "string" then
		warn(string.format("[PointsSystem] Player %s sent invalid itemId", player.Name))
		return end

	-- Rate limiting: max 10 collects per minute
	local allowed, err = checkRateLimit(player, "collect", CONFIG.MAX_COLLECTS_PER_MINUTE, 60)
	if not allowed then
		warn(string.format("[PointsSystem] Player %s collect rate limited: %s", player.Name, err))
		return end

	-- Award points server-side
	local newTotal = addPoints(player, CONFIG.COLLECT_ITEM_POINTS)
	print(string.format("[PointsSystem] Player %s collected item %s! +%d points (Total: %d)", player.Name, itemId, CONFIG.COLLECT_ITEM_POINTS, newTotal))

	-- Fire client with updated points and item id
	collectItemRemote:FireServer(player, newTotal, itemId)
end)

-- Handle GetPoints RemoteFunction (for client to query current points)
getPointsRemote.OnServerInvoke = function(player)
	if not player or type(player) ~= "Player" then return 0 end
	return getPoints(player)
end

-- Player lifecycle
Players.PlayerAdded:Connect(function(player)
	initPlayer(player)
	print(string.format("[PointsSystem] Player %s joined. Points initialized.", player.Name))
end)

Players.PlayerRemoving:Connect(function(player)
	removePlayerData(player)
	print(string.format("[PointsSystem] Player %s left. Rate limit data cleared.", player.Name))
end)

-- Admin command for testing (optional)
local function onChatCommand(player, message)
	if message:sub(1, 7) == "/points" then
		local parts = message:split(" ")
		if #parts == 2 and parts[2] == "reset" then
			-- Only allow if player has admin permissions (simplified check)
			if player:GetRankInGroup(0) >= 255 then
				playerPoints[player.UserId] = 0
				print(string.format("[PointsSystem] Admin %s reset points for %s", player.Name, player.Name))
			else
				warn("[PointsSystem] Admin command not authorized for non-admin")
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
	end
end)

print("[PointsSystem] Server-authoritative points system initialized")
print(string.format("[PointsSystem] Config: Cheer=%dpts, Collect=%dpts, CheerRate=%d/min, CollectRate=%d/min",
	CONFIG.CHEER_POINTS, CONFIG.COLLECT_ITEM_POINTS, CONFIG.MAX_CHEERS_PER_MINUTE, CONFIG.MAX_COLLECTS_PER_MINUTE))

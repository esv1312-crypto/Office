--[[
    Football Fans District - MVP Gameplay
    Place in ServerScriptService as Gameplay.server.lua.
    Session-only XP/levels and proximity interactions for the greybox.
    Persistent saving and custom chat moderation are not included yet.
]]

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local district = Workspace:WaitForChild("FootballFansDistrict")
local visitZones = district:WaitForChild("VisitZones")
local interactables = district:WaitForChild("Interactables")

local playerState = {}
local promptCooldowns = {}

local function getState(player)
    local state = playerState[player.UserId]
    if not state then
        state = { visited = {} }
        playerState[player.UserId] = state
    end
    return state
end

local function getStats(player)
    local leaderstats = player:FindFirstChild("leaderstats")
    if not leaderstats then return nil end
    local xp = leaderstats:FindFirstChild("XP")
    local level = leaderstats:FindFirstChild("Level")
    if not xp or not level then return nil end
    return xp, level
end

local function awardXP(player, amount, reason)
    if not player or player.Parent ~= Players then return end
    local xp, level = getStats(player)
    if not xp or not level then return end

    local reward = math.max(0, math.floor(amount))
    if reward == 0 then return end

    xp.Value += reward
    while xp.Value >= level.Value * 100 do
        xp.Value -= level.Value * 100
        level.Value += 1
    end

    player:SetAttribute("LastFanDistrictReward", tostring(reason or "Activity"))
    print(string.format("[FanDistrict] %s earned %d XP (%s)", player.Name, reward, tostring(reason or "Activity")))
end

Players.PlayerAdded:Connect(function(player)
    local leaderstats = Instance.new("Folder")
    leaderstats.Name = "leaderstats"
    leaderstats.Parent = player

    local xp = Instance.new("IntValue")
    xp.Name = "XP"
    xp.Value = 0
    xp.Parent = leaderstats

    local level = Instance.new("IntValue")
    level.Name = "Level"
    level.Value = 1
    level.Parent = leaderstats

    getState(player)
end)

Players.PlayerRemoving:Connect(function(player)
    playerState[player.UserId] = nil
    promptCooldowns[player.UserId] = nil
end)

local function playerFromHit(hit)
    if not hit then return nil end
    local character = hit:FindFirstAncestorOfClass("Model")
    if not character then return nil end
    return Players:GetPlayerFromCharacter(character)
end

for _, zone in ipairs(visitZones:GetChildren()) do
    if zone:IsA("BasePart") then
        zone.Touched:Connect(function(hit)
            local player = playerFromHit(hit)
            if not player then return end
            local state = getState(player)
            if state.visited[zone.Name] then return end
            state.visited[zone.Name] = true
            awardXP(player, 25, "Visited " .. zone.Name)
        end)
    end
end

for _, item in ipairs(interactables:GetDescendants()) do
    if item:IsA("ProximityPrompt") then
        item.Triggered:Connect(function(player)
            local userId = player.UserId
            promptCooldowns[userId] = promptCooldowns[userId] or {}
            local now = os.clock()
            local lastUsed = promptCooldowns[userId][item.Name] or 0
            local cooldown = tonumber(item:GetAttribute("CooldownSeconds")) or 20
            if now - lastUsed < cooldown then return end
            promptCooldowns[userId][item.Name] = now

            local reward = tonumber(item:GetAttribute("RewardXP")) or 10
            awardXP(player, reward, item.ObjectText)
        end)
    end
end

print("[FanDistrict] Gameplay systems ready. XP and levels are session-only in this MVP.")

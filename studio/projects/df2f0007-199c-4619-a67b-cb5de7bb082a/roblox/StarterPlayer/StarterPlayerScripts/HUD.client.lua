--[[
    Football Fans District - Client HUD
    Place in StarterPlayer > StarterPlayerScripts as HUD.client.lua.
    This is a LocalScript and is the only file in this MVP using LocalPlayer.
]]

local Players = game:GetService("Players")
local player = Players.LocalPlayer
local playerGui = player:WaitForChild("PlayerGui")

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "FanDistrictHUD"
screenGui.ResetOnSpawn = false
screenGui.Parent = playerGui

local panel = Instance.new("Frame")
panel.Name = "StatsPanel"
panel.AnchorPoint = Vector2.new(0, 0)
panel.Position = UDim2.fromOffset(18, 18)
panel.Size = UDim2.fromOffset(230, 76)
panel.BackgroundColor3 = Color3.fromRGB(24, 31, 44)
panel.BackgroundTransparency = 0.12
panel.Parent = screenGui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 12)
corner.Parent = panel

local stroke = Instance.new("UIStroke")
stroke.Color = Color3.fromRGB(235, 177, 55)
stroke.Thickness = 2
stroke.Parent = panel

local title = Instance.new("TextLabel")
title.Name = "Title"
title.Position = UDim2.fromOffset(12, 6)
title.Size = UDim2.new(1, -24, 0, 24)
title.BackgroundTransparency = 1
title.Font = Enum.Font.GothamBold
title.Text = "FAN DISTRICT"
title.TextColor3 = Color3.fromRGB(235, 177, 55)
title.TextSize = 16
title.TextXAlignment = Enum.TextXAlignment.Left
title.Parent = panel

local statsLabel = Instance.new("TextLabel")
statsLabel.Name = "Stats"
statsLabel.Position = UDim2.fromOffset(12, 32)
statsLabel.Size = UDim2.new(1, -24, 0, 32)
statsLabel.BackgroundTransparency = 1
statsLabel.Font = Enum.Font.GothamMedium
statsLabel.Text = "Level 1  •  XP 0 / 100"
statsLabel.TextColor3 = Color3.fromRGB(245, 247, 250)
statsLabel.TextSize = 15
statsLabel.TextXAlignment = Enum.TextXAlignment.Left
statsLabel.Parent = panel

local leaderstats = player:WaitForChild("leaderstats")
local xp = leaderstats:WaitForChild("XP")
local level = leaderstats:WaitForChild("Level")

local function refresh()
    local needed = level.Value * 100
    statsLabel.Text = string.format("Level %d  •  XP %d / %d", level.Value, xp.Value, needed)
end

xp.Changed:Connect(refresh)
level.Changed:Connect(refresh)
refresh()

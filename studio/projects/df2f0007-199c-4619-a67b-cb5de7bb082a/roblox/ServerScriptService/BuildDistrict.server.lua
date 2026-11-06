--[[
    Football Fans District - Greybox Builder
    Place in ServerScriptService as BuildDistrict.server.lua.
    Builds a deterministic, asset-free first-pass district from native Parts.
    This script has not yet been executed in Roblox Studio.
]]

local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")

local ROOT_NAME = "FootballFansDistrict"
local defaultBaseplate = Workspace:FindFirstChild("Baseplate")
if defaultBaseplate and defaultBaseplate:IsA("BasePart") then
    defaultBaseplate:Destroy()
end
local old = Workspace:FindFirstChild(ROOT_NAME)
if old then old:Destroy() end

local root = Instance.new("Folder")
root.Name = ROOT_NAME
root.Parent = Workspace

local geometry = Instance.new("Folder")
geometry.Name = "Geometry"
geometry.Parent = root

local visitZones = Instance.new("Folder")
visitZones.Name = "VisitZones"
visitZones.Parent = root

local interactables = Instance.new("Folder")
interactables.Name = "Interactables"
interactables.Parent = root

local COLORS = {
    concrete = Color3.fromRGB(105, 112, 122),
    dark = Color3.fromRGB(28, 34, 44),
    pitch = Color3.fromRGB(42, 125, 67),
    white = Color3.fromRGB(238, 241, 245),
    home = Color3.fromRGB(190, 48, 54),
    away = Color3.fromRGB(45, 91, 180),
    gold = Color3.fromRGB(235, 177, 55),
    wood = Color3.fromRGB(120, 78, 48),
}

local function part(parent, name, size, position, color, material, transparency, canCollide)
    local item = Instance.new("Part")
    item.Name = name
    item.Size = size
    item.Position = position
    item.Anchored = true
    item.CanCollide = canCollide ~= false
    item.CanTouch = true
    item.TopSurface = Enum.SurfaceType.Smooth
    item.BottomSurface = Enum.SurfaceType.Smooth
    item.Color = color or COLORS.concrete
    item.Material = material or Enum.Material.Concrete
    item.Transparency = transparency or 0
    item.Parent = parent
    return item
end

local function label(parent, name, text, position, width, height, color)
    local anchor = part(parent, name, Vector3.new(1, 1, 1), position, COLORS.dark, Enum.Material.SmoothPlastic)
    anchor.Transparency = 1
    anchor.CanCollide = false
    local gui = Instance.new("BillboardGui")
    gui.Name = "Label"
    gui.Size = UDim2.fromOffset(width or 260, height or 64)
    gui.StudsOffset = Vector3.new(0, 4, 0)
    gui.AlwaysOnTop = true
    gui.Parent = anchor
    local textLabel = Instance.new("TextLabel")
    textLabel.Size = UDim2.fromScale(1, 1)
    textLabel.BackgroundColor3 = COLORS.dark
    textLabel.BackgroundTransparency = 0.15
    textLabel.TextColor3 = color or COLORS.white
    textLabel.Text = text
    textLabel.TextScaled = true
    textLabel.Font = Enum.Font.GothamBold
    textLabel.Parent = gui
    local corner = Instance.new("UICorner")
    corner.CornerRadius = UDim.new(0, 10)
    corner.Parent = textLabel
    return anchor
end

local function prompt(parent, name, action, objectText, rewardXP, cooldown)
    local p = Instance.new("ProximityPrompt")
    p.Name = name
    p.ActionText = action
    p.ObjectText = objectText
    p.KeyboardKeyCode = Enum.KeyCode.E
    p.HoldDuration = 0.35
    p.MaxActivationDistance = 12
    p.RequiresLineOfSight = false
    p:SetAttribute("RewardXP", rewardXP or 10)
    p:SetAttribute("CooldownSeconds", cooldown or 20)
    p.Parent = parent
    return p
end

-- Ground and central plaza
part(geometry, "DistrictGround", Vector3.new(600, 2, 600), Vector3.new(0, -2, 0), Color3.fromRGB(67, 76, 72), Enum.Material.Grass)
part(geometry, "CentralPlaza", Vector3.new(112, 2, 112), Vector3.new(0, 0, 0), COLORS.concrete, Enum.Material.Concrete)
part(geometry, "PlazaCenter", Vector3.new(24, 1, 24), Vector3.new(0, 1.5, 0), COLORS.gold, Enum.Material.Slate)
label(geometry, "PlazaSign", "FAN DISTRICT", Vector3.new(0, 7, 0), 280, 70)

-- Walkways connect the main locations
part(geometry, "PathToStadium", Vector3.new(26, 1, 130), Vector3.new(0, -0.45, -120), COLORS.concrete, Enum.Material.Concrete)
part(geometry, "PathToHomeZone", Vector3.new(125, 1, 22), Vector3.new(-112, -0.45, 0), COLORS.concrete, Enum.Material.Concrete)
part(geometry, "PathToAwayZone", Vector3.new(125, 1, 22), Vector3.new(112, -0.45, 0), COLORS.concrete, Enum.Material.Concrete)
part(geometry, "PathToFanBar", Vector3.new(22, 1, 100), Vector3.new(-72, -0.45, 100), COLORS.concrete, Enum.Material.Concrete)
part(geometry, "PathToMeetingHall", Vector3.new(22, 1, 100), Vector3.new(72, -0.45, 100), COLORS.concrete, Enum.Material.Concrete)

-- Stadium field and simple stands
local fieldCenter = Vector3.new(0, 0, -205)
part(geometry, "StadiumField", Vector3.new(154, 1, 94), fieldCenter, COLORS.pitch, Enum.Material.Grass)
for x = -65, 65, 130 do
    part(geometry, "TouchLine", Vector3.new(1, 0.2, 88), Vector3.new(x, 0.65, -205), COLORS.white, Enum.Material.SmoothPlastic)
end
for z = -245, -165, 80 do
    part(geometry, "GoalLine", Vector3.new(150, 0.2, 1), Vector3.new(0, 0.65, z), COLORS.white, Enum.Material.SmoothPlastic)
end
part(geometry, "HalfwayLine", Vector3.new(1, 0.2, 90), Vector3.new(0, 0.65, -205), COLORS.white, Enum.Material.SmoothPlastic)
part(geometry, "CenterCircleMarker", Vector3.new(18, 0.2, 18), Vector3.new(0, 0.7, -205), COLORS.white, Enum.Material.SmoothPlastic, 0.2, false)

for sideIndex, x in ipairs({-92, 92}) do
    local seatColor = sideIndex == 1 and COLORS.home or COLORS.away
    for row = 1, 6 do
        local z = -250 + (row * 11)
        part(geometry, "StandTier_" .. sideIndex .. "_" .. row,
            Vector3.new(20, 3, 8), Vector3.new(x, row * 2, z), seatColor, Enum.Material.Concrete)
    end
    part(geometry, "StandBack_" .. sideIndex, Vector3.new(8, 22, 100),
        Vector3.new(x + (sideIndex == 1 and -12 or 12), 11, -205), COLORS.dark, Enum.Material.Metal)
end

-- Stadium outer walls and roof beams
part(geometry, "StadiumNorthWall", Vector3.new(190, 28, 8), Vector3.new(0, 14, -265), COLORS.dark, Enum.Material.Concrete)
part(geometry, "StadiumSouthWall", Vector3.new(190, 28, 8), Vector3.new(0, 14, -145), COLORS.dark, Enum.Material.Concrete)
part(geometry, "StadiumRoofBeamLeft", Vector3.new(8, 3, 120), Vector3.new(-100, 28, -205), COLORS.dark, Enum.Material.Metal)
part(geometry, "StadiumRoofBeamRight", Vector3.new(8, 3, 120), Vector3.new(100, 28, -205), COLORS.dark, Enum.Material.Metal)
label(geometry, "StadiumSign", "HOME OF THE FANS", Vector3.new(0, 34, -145), 340, 76, COLORS.gold)

-- Goal frames (visual placeholders)
for index, z in ipairs({-252, -158}) do
    part(geometry, "GoalCrossbar_" .. index, Vector3.new(24, 1, 1), Vector3.new(0, 9, z), COLORS.white, Enum.Material.Metal)
    part(geometry, "GoalPostL_" .. index, Vector3.new(1, 18, 1), Vector3.new(-12, 0, z), COLORS.white, Enum.Material.Metal)
    part(geometry, "GoalPostR_" .. index, Vector3.new(1, 18, 1), Vector3.new(12, 0, z), COLORS.white, Enum.Material.Metal)
end

-- Home and away supporter zones
local function supporterZone(name, center, color, subtitle)
    local zone = part(geometry, name, Vector3.new(82, 2, 72), center, color, Enum.Material.Slate)
    label(geometry, name .. "Sign", subtitle, center + Vector3.new(0, 8, 0), 280, 64)
    for i = -2, 2 do
        part(geometry, name .. "_Bench_" .. i, Vector3.new(18, 3, 5),
            center + Vector3.new(i * 13, 2.5, 24), COLORS.wood, Enum.Material.WoodPlanks)
    end
    local trigger = part(visitZones, name .. "Visit", Vector3.new(78, 10, 68),
        center + Vector3.new(0, 5, 0), color, Enum.Material.ForceField, 1, false)
    trigger.CanTouch = true
    local kiosk = part(interactables, name .. "Kiosk", Vector3.new(8, 8, 8),
        center + Vector3.new(0, 4, -22), COLORS.gold, Enum.Material.Neon)
    prompt(kiosk, name .. "Prompt", "Join the supporters", "Supporter zone", 15, 25)
    return zone
end

supporterZone("HomeSupporterZone", Vector3.new(-178, 0, 0), COLORS.home, "HOME SUPPORTERS")
supporterZone("AwaySupporterZone", Vector3.new(178, 0, 0), COLORS.away, "AWAY SUPPORTERS")

-- Two social gathering hubs
local function gatheringHub(name, center, subtitle)
    part(geometry, name .. "Floor", Vector3.new(58, 2, 48), center, COLORS.wood, Enum.Material.WoodPlanks)
    part(geometry, name .. "BackWall", Vector3.new(58, 16, 3), center + Vector3.new(0, 8, -22), COLORS.dark, Enum.Material.Wood)
    part(geometry, name .. "Roof", Vector3.new(62, 2, 52), center + Vector3.new(0, 17, 0), COLORS.dark, Enum.Material.Metal)
    for x = -18, 18, 12 do
        part(geometry, name .. "Seat_" .. x, Vector3.new(10, 2, 4), center + Vector3.new(x, 2, 10), COLORS.gold, Enum.Material.Wood)
    end
    label(geometry, name .. "Sign", subtitle, center + Vector3.new(0, 22, 0), 260, 64)
    local kiosk = part(interactables, name .. "Kiosk", Vector3.new(6, 7, 6), center + Vector3.new(0, 4, -10), COLORS.gold, Enum.Material.Neon)
    prompt(kiosk, name .. "Prompt", "Meet the fans", subtitle, 20, 30)
end

gatheringHub("FanBar", Vector3.new(-72, 0, 115), "FAN BAR")
gatheringHub("MeetingHall", Vector3.new(72, 0, 115), "MEETING HALL")

-- Plaza activity kiosk and visit zone
local plazaTrigger = part(visitZones, "PlazaVisit", Vector3.new(100, 10, 100), Vector3.new(0, 5, 0), COLORS.gold, Enum.Material.ForceField, 1, false)
plazaTrigger.CanTouch = true
local triviaKiosk = part(interactables, "TriviaKiosk", Vector3.new(10, 9, 8), Vector3.new(36, 4.5, 30), COLORS.gold, Enum.Material.Neon)
label(geometry, "TriviaSign", "FAN TRIVIA", Vector3.new(36, 10, 30), 200, 54)
prompt(triviaKiosk, "TriviaPrompt", "Play fan trivia", "Fan trivia", 35, 45)

local penaltyKiosk = part(interactables, "PenaltyKiosk", Vector3.new(10, 9, 8), Vector3.new(-36, 4.5, -30), COLORS.home, Enum.Material.Neon)
label(geometry, "PenaltySign", "PENALTY CHALLENGE", Vector3.new(-36, 10, -30), 250, 54)
prompt(penaltyKiosk, "PenaltyPrompt", "Take a penalty", "Penalty challenge", 50, 60)

-- Spawn point
local spawn = Instance.new("SpawnLocation")
spawn.Name = "FanDistrictSpawn"
spawn.Size = Vector3.new(12, 1, 12)
spawn.Position = Vector3.new(0, 2, 42)
spawn.Anchored = true
spawn.Neutral = true
spawn.Duration = 0
spawn.AllowTeamChangeOnTouch = false
spawn.Color = COLORS.gold
spawn.Material = Enum.Material.Neon
spawn.Parent = geometry

-- Night-match lighting
Lighting.ClockTime = 20
Lighting.Brightness = 2
Lighting.Ambient = Color3.fromRGB(68, 76, 100)
Lighting.OutdoorAmbient = Color3.fromRGB(55, 64, 85)
Lighting.EnvironmentDiffuseScale = 0.35
Lighting.EnvironmentSpecularScale = 0.6

local atmosphere = Lighting:FindFirstChildOfClass("Atmosphere") or Instance.new("Atmosphere")
atmosphere.Density = 0.25
atmosphere.Offset = 0.1
atmosphere.Color = Color3.fromRGB(175, 190, 220)
atmosphere.Decay = Color3.fromRGB(75, 85, 120)
atmosphere.Parent = Lighting

local bloom = Lighting:FindFirstChildOfClass("BloomEffect") or Instance.new("BloomEffect")
bloom.Intensity = 0.25
bloom.Size = 24
bloom.Threshold = 1.5
bloom.Parent = Lighting

print("[FootballFansDistrict] Greybox world created. Add Gameplay.server.lua and HUD.client.lua.")

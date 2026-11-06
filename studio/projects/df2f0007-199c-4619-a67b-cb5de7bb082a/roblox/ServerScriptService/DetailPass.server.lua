--[[
    Football Fans District - Visual Detail Pass
    Place in ServerScriptService as DetailPass.server.lua.
    Runs after BuildDistrict.server.lua and adds architectural detail,
    lighting, banners, storefronts and street furniture using native Roblox parts.
    This script has not yet been executed in Roblox Studio.
]]

local Workspace = game:GetService("Workspace")
local Lighting = game:GetService("Lighting")

local district = Workspace:WaitForChild("FootballFansDistrict", 30)
if not district then
    warn("[FootballFansDistrict] Detail pass skipped: builder folder not found.")
    return
end

local old = district:FindFirstChild("ArtPass")
if old then old:Destroy() end

local art = Instance.new("Folder")
art.Name = "ArtPass"
art.Parent = district

local C = {
    navy = Color3.fromRGB(18, 25, 39),
    charcoal = Color3.fromRGB(32, 39, 52),
    concrete = Color3.fromRGB(128, 137, 148),
    glass = Color3.fromRGB(93, 190, 220),
    warm = Color3.fromRGB(255, 190, 86),
    red = Color3.fromRGB(205, 48, 58),
    blue = Color3.fromRGB(48, 103, 202),
    white = Color3.fromRGB(245, 246, 249),
    green = Color3.fromRGB(46, 137, 78),
}

local function make(name, size, pos, color, material, parent, transparency)
    local p = Instance.new("Part")
    p.Name = name
    p.Size = size
    p.Position = pos
    p.Anchored = true
    p.TopSurface = Enum.SurfaceType.Smooth
    p.BottomSurface = Enum.SurfaceType.Smooth
    p.Color = color
    p.Material = material or Enum.Material.SmoothPlastic
    p.Transparency = transparency or 0
    p.Parent = parent or art
    return p
end

local function neon(name, size, pos, color)
    local p = make(name, size, pos, color, Enum.Material.Neon)
    p.CanCollide = false
    return p
end

local function pointLight(parent, color, brightness, range)
    local light = Instance.new("PointLight")
    light.Color = color
    light.Brightness = brightness
    light.Range = range
    light.Shadows = true
    light.Parent = parent
end

local function sign(name, text, pos, width, color)
    local board = make(name, Vector3.new(width, 5, 1), pos, C.navy, Enum.Material.Metal)
    local gui = Instance.new("SurfaceGui")
    gui.Face = Enum.NormalId.Front
    gui.CanvasSize = Vector2.new(800, 220)
    gui.Parent = board
    local label = Instance.new("TextLabel")
    label.Size = UDim2.fromScale(1, 1)
    label.BackgroundTransparency = 1
    label.Text = text
    label.TextColor3 = color or C.white
    label.TextScaled = true
    label.Font = Enum.Font.GothamBlack
    label.Parent = gui
    return board
end

-- Detailed street lamps around the plaza and connecting roads.
local lampPositions = {
    Vector3.new(-48, 0, 0), Vector3.new(48, 0, 0),
    Vector3.new(0, 0, -68), Vector3.new(0, 0, 68),
    Vector3.new(-72, 0, 65), Vector3.new(72, 0, 65),
    Vector3.new(-72, 0, 165), Vector3.new(72, 0, 165),
    Vector3.new(-130, 0, -42), Vector3.new(130, 0, -42),
    Vector3.new(-130, 0, 42), Vector3.new(130, 0, 42),
}
for i, pos in ipairs(lampPositions) do
    make("StreetLampPole_" .. i, Vector3.new(1.2, 17, 1.2), pos + Vector3.new(0, 8.5, 0), C.charcoal, Enum.Material.Metal)
    local arm = make("StreetLampArm_" .. i, Vector3.new(7, 0.7, 0.7), pos + Vector3.new(3, 16.5, 0), C.charcoal, Enum.Material.Metal)
    local bulb = neon("StreetLampGlow_" .. i, Vector3.new(4, 0.5, 2), pos + Vector3.new(5, 16, 0), C.warm)
    pointLight(bulb, C.warm, 1.6, 28)
end

-- Multi-storey fan street: facades, repeated windows, awnings and shop signs.
local function storefront(name, center, accent, title)
    make(name .. "_Building", Vector3.new(46, 30, 26), center + Vector3.new(0, 15, 0), C.charcoal, Enum.Material.Brick)
    make(name .. "_RoofTrim", Vector3.new(48, 1.5, 28), center + Vector3.new(0, 30.5, 0), accent, Enum.Material.Metal)
    for floor = 1, 2 do
        for col = -1, 1 do
            local window = make(name .. "_Window_" .. floor .. "_" .. col,
                Vector3.new(9, 7, 0.5),
                center + Vector3.new(col * 13, floor == 1 and 22 or 10, -13.4),
                C.glass, Enum.Material.Glass, art, 0.18)
            window.Reflectance = 0.12
            make(name .. "_WindowFrame_" .. floor .. "_" .. col,
                Vector3.new(9.8, 0.7, 0.8),
                center + Vector3.new(col * 13, floor == 1 and 26 or 14, -13.8),
                C.white, Enum.Material.Metal)
        end
    end
    make(name .. "_Awning", Vector3.new(44, 1, 5), center + Vector3.new(0, 7, -16), accent, Enum.Material.Fabric)
    sign(name .. "_Sign", title, center + Vector3.new(0, 5.5, -17), 28, C.white)
    for col = -1, 1 do
        local display = make(name .. "_Display_" .. col, Vector3.new(7, 5, 0.8),
            center + Vector3.new(col * 13, 2.8, -13.8), C.glass, Enum.Material.Glass, art, 0.3)
        display.Reflectance = 0.1
    end
end

storefront("HomeKitStore", Vector3.new(-130, 0, 122), C.red, "HOME KIT")
storefront("AwayKitStore", Vector3.new(130, 0, 122), C.blue, "AWAY KIT")
storefront("FanCafe", Vector3.new(-130, 0, 185), C.warm, "FAN CAFE")
storefront("ClubMuseum", Vector3.new(130, 0, 185), C.glass, "CLUB MUSEUM")

-- Roofline and stadium floodlights.
for side, x in ipairs({-100, 100}) do
    for i, z in ipairs({-252, -205, -158}) do
        local tower = make("FloodlightTower_" .. side .. "_" .. i,
            Vector3.new(2, 42, 2), Vector3.new(x, 21, z), C.charcoal, Enum.Material.Metal)
        local lamp = neon("Floodlight_" .. side .. "_" .. i,
            Vector3.new(12, 2, 5), Vector3.new(x, 42, z), C.white)
        pointLight(lamp, Color3.fromRGB(225, 239, 255), 2.5, 65)
        make("FloodlightBrace_" .. side .. "_" .. i,
            Vector3.new(8, 1, 1), Vector3.new(x, 35, z), C.charcoal, Enum.Material.Metal)
    end
end

-- Club banners and flags: simple cloth panels with contrasting stripes.
local function banner(name, pos, mainColor, stripeColor)
    make(name .. "_Pole", Vector3.new(0.8, 18, 0.8), pos + Vector3.new(0, 9, 0), C.white, Enum.Material.Metal)
    make(name .. "_Cloth", Vector3.new(9, 6, 0.35), pos + Vector3.new(4.8, 14, 0), mainColor, Enum.Material.Fabric)
    make(name .. "_Stripe", Vector3.new(1.4, 6.1, 0.4), pos + Vector3.new(4.8, 14, -0.05), stripeColor, Enum.Material.Fabric)
end

for i = 1, 4 do
    banner("HomeBanner_" .. i, Vector3.new(-210 + i * 16, 0, -28), C.red, C.white)
    banner("AwayBanner_" .. i, Vector3.new(146 + i * 16, 0, -28), C.blue, C.white)
end

-- Decorative plaza rings and a football sculpture.
for i = 1, 3 do
    local ring = make("PlazaRing_" .. i, Vector3.new(34 + i * 12, 0.35, 34 + i * 12),
        Vector3.new(0, 2 + i * 0.08, 0), i == 2 and C.warm or C.white, Enum.Material.Metal)
    ring.Shape = Enum.PartType.Cylinder
    ring.Orientation = Vector3.new(0, 0, 90)
    ring.CanCollide = false
end
local ball = make("PlazaFootball", Vector3.new(9, 9, 9), Vector3.new(0, 12, 0), C.white, Enum.Material.SmoothPlastic)
ball.Shape = Enum.PartType.Ball
ball.CanCollide = false
ball.Reflectance = 0.18
local ballGlow = neon("FootballPedestalGlow", Vector3.new(12, 0.4, 12), Vector3.new(0, 7, 0), C.warm)
ballGlow.CanCollide = false

-- Trees, planters and benches to soften the concrete-heavy first pass.
local treePositions = {
    Vector3.new(-52, 0, -48), Vector3.new(52, 0, -48),
    Vector3.new(-52, 0, 48), Vector3.new(52, 0, 48),
    Vector3.new(-96, 0, 75), Vector3.new(96, 0, 75),
    Vector3.new(-96, 0, 210), Vector3.new(96, 0, 210),
}
for i, pos in ipairs(treePositions) do
    make("Planter_" .. i, Vector3.new(12, 2, 12), pos + Vector3.new(0, 1, 0), C.concrete, Enum.Material.Concrete)
    make("TreeTrunk_" .. i, Vector3.new(2, 10, 2), pos + Vector3.new(0, 7, 0), Color3.fromRGB(95, 65, 42), Enum.Material.Wood)
    local crown = make("TreeCrown_" .. i, Vector3.new(13, 13, 13), pos + Vector3.new(0, 15, 0), C.green, Enum.Material.Grass)
    crown.Shape = Enum.PartType.Ball
    crown.CanCollide = false
    make("Bench_" .. i, Vector3.new(12, 1, 3), pos + Vector3.new(10, 2, 0), C.wood or Color3.fromRGB(120, 78, 48), Enum.Material.Wood)
end

-- Team-color light accents along the entrance to each supporter zone.
for i = 1, 5 do
    neon("HomeZoneAccent_" .. i, Vector3.new(12, 0.5, 1),
        Vector3.new(-220 + i * 18, 1.2, 38), C.red)
    neon("AwayZoneAccent_" .. i, Vector3.new(12, 0.5, 1),
        Vector3.new(148 + i * 18, 1.2, 38), C.blue)
end

-- Global post-processing: stronger night-match atmosphere without blinding bloom.
local bloom = Lighting:FindFirstChildOfClass("BloomEffect")
if bloom then
    bloom.Intensity = 0.45
    bloom.Size = 28
    bloom.Threshold = 1.25
end

print("[FootballFansDistrict] Visual detail pass created: storefronts, banners, lamps, floodlights, plaza sculpture and street furniture.")

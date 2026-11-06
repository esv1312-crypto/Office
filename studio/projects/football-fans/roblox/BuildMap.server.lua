-- Football Fans: first district blockout
-- Run in a disposable Roblox Studio place via the Command Bar.
-- Safe to rerun: only Workspace.FootballFansMap is replaced.

local Workspace = game:GetService("Workspace")

local oldMap = Workspace:FindFirstChild("FootballFansMap")
if oldMap then
	oldMap:Destroy()
end

local root = Instance.new("Folder")
root.Name = "FootballFansMap"
root.Parent = Workspace

local C = {
	ground = Color3.fromRGB(91, 126, 83),
	asphalt = Color3.fromRGB(55, 59, 65),
	concrete = Color3.fromRGB(156, 160, 164),
	dark = Color3.fromRGB(35, 39, 45),
	white = Color3.fromRGB(238, 239, 232),
	green = Color3.fromRGB(48, 133, 75),
	lightGreen = Color3.fromRGB(75, 164, 91),
	blue = Color3.fromRGB(48, 112, 176),
	orange = Color3.fromRGB(225, 122, 48),
	red = Color3.fromRGB(184, 61, 61),
	glass = Color3.fromRGB(126, 177, 194),
}

local function folder(name, parent)
	local f = Instance.new("Folder")
	f.Name = name
	f.Parent = parent or root
	return f
end

local function part(parent, name, size, position, color, material)
	local p = Instance.new("Part")
	p.Name = name
	p.Size = size
	p.Position = position
	p.Anchored = true
	p.TopSurface = Enum.SurfaceType.Smooth
	p.BottomSurface = Enum.SurfaceType.Smooth
	p.Color = color or C.concrete
	p.Material = material or Enum.Material.Concrete
	p.Parent = parent
	return p
end

local function sign(parent, name, text, position, size, color)
	local board = part(parent, name, size, position, color or C.dark, Enum.Material.Metal)
	board.CanCollide = false
	local gui = Instance.new("SurfaceGui")
	gui.Name = "SignSurface"
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 45
	gui.Parent = board
	local label = Instance.new("TextLabel")
	label.Name = "Text"
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Text = text
	label.TextColor3 = C.white
	label.TextScaled = true
	label.Font = Enum.Font.GothamBold
	label.Parent = gui
	return board
end

local function lamp(parent, x, z)
	part(parent, "LampPost", Vector3.new(2, 22, 2), Vector3.new(x, 11, z), C.dark, Enum.Material.Metal)
	part(parent, "LampHead", Vector3.new(8, 2, 4), Vector3.new(x, 22, z), C.white, Enum.Material.Neon)
end

local function banner(parent, x, z, color)
	part(parent, "BannerPole", Vector3.new(1, 18, 1), Vector3.new(x, 9, z), C.dark, Enum.Material.Metal)
	part(parent, "FanBanner", Vector3.new(1, 10, 7), Vector3.new(x + 3, 11, z), color, Enum.Material.Fabric)
end

local function building(parent, name, x, z, width, depth, height, color, label)
	local m = Instance.new("Model")
	m.Name = name
	m.Parent = parent
	part(m, "MainVolume", Vector3.new(width, height, depth), Vector3.new(x, height / 2, z), color, Enum.Material.Concrete)
	part(m, "Roof", Vector3.new(width + 4, 3, depth + 4), Vector3.new(x, height + 1.5, z), C.dark, Enum.Material.Metal)
	part(m, "FrontWindowBand", Vector3.new(width * 0.68, height * 0.28, 2), Vector3.new(x, height * 0.58, z - depth / 2 - 1), C.glass, Enum.Material.Glass)
	sign(m, "StoreSign", label, Vector3.new(x, height * 0.78, z - depth / 2 - 2.2), Vector3.new(math.min(width * 0.72, 54), 7, 1), C.blue)
	return m
end

-- Base terrain and district folders
local terrain = folder("Terrain")
local streets = folder("Streets")
local arrival = folder("ArrivalPlaza")
local square = folder("SupportersSquare")
local shops = folder("FanStreetAndShops")
local pitch = folder("MiniPitch")
local forecourt = folder("StadiumForecourt")
local stadium = folder("MainStadium")
local details = folder("StreetDetails")

part(terrain, "DistrictGround", Vector3.new(1100, 8, 920), Vector3.new(0, -4, 0), C.ground, Enum.Material.Grass)

-- Main pedestrian streets and connecting paths
part(streets, "FanStreetMain", Vector3.new(720, 1, 34), Vector3.new(-20, 0.5, 105), C.asphalt, Enum.Material.Asphalt)
part(streets, "WestConnector", Vector3.new(34, 1, 300), Vector3.new(-330, 0.5, 255), C.asphalt, Enum.Material.Asphalt)
part(streets, "SquareToStadium", Vector3.new(34, 1, 300), Vector3.new(260, 0.5, 145), C.asphalt, Enum.Material.Asphalt)
part(streets, "SouthConnector", Vector3.new(600, 1, 30), Vector3.new(-20, 0.5, -285), C.asphalt, Enum.Material.Asphalt)
part(streets, "NorthWalkway", Vector3.new(540, 1, 28), Vector3.new(0, 0.5, 300), C.asphalt, Enum.Material.Asphalt)

-- Arrival Plaza and spawn
part(arrival, "ArrivalPaving", Vector3.new(190, 2, 150), Vector3.new(-330, 1, 270), C.concrete, Enum.Material.Concrete)
local spawn = Instance.new("SpawnLocation")
spawn.Name = "PlayerSpawn"
spawn.Size = Vector3.new(18, 1, 18)
spawn.Position = Vector3.new(-365, 3, 300)
spawn.Anchored = true
spawn.Neutral = true
spawn.Duration = 0
spawn.Color = C.green
spawn.Material = Enum.Material.Neon
spawn.Parent = arrival
sign(arrival, "WelcomeSign", "WELCOME TO FAN DISTRICT", Vector3.new(-330, 24, 195), Vector3.new(74, 18, 2), C.blue)
sign(arrival, "SquareDirection", "SQUARE  →", Vector3.new(-260, 10, 240), Vector3.new(28, 8, 2), C.dark)
sign(arrival, "PitchDirection", "←  MINI PITCH", Vector3.new(-390, 10, 240), Vector3.new(32, 8, 2), C.dark)
sign(arrival, "StadiumDirection", "STADIUM  ↑", Vector3.new(-330, 10, 215), Vector3.new(32, 8, 2), C.dark)

-- Social heart
part(square, "SquarePaving", Vector3.new(210, 2, 190), Vector3.new(0, 1, 0), C.concrete, Enum.Material.Concrete)
part(square, "EventStage", Vector3.new(58, 8, 22), Vector3.new(0, 5, 58), C.dark, Enum.Material.Metal)
sign(square, "SquareStageSign", "SUPPORTERS' SQUARE", Vector3.new(0, 17, 46), Vector3.new(58, 12, 2), C.orange)
part(square, "CentralEmblem", Vector3.new(42, 1, 42), Vector3.new(0, 2.2, -22), C.blue, Enum.Material.SmoothPlastic)
for i = -2, 2 do
	part(square, "SquareBench", Vector3.new(26, 3, 5), Vector3.new(i * 34, 3, -72), C.dark, Enum.Material.WoodPlanks)
end

-- Fan Street storefronts and hangouts
building(shops, "FanShop", -250, -100, 76, 58, 28, C.orange, "FAN SHOP")
building(shops, "SupportersCafe", 230, -120, 82, 62, 30, C.blue, "THE TERRACE CAFE")
part(shops, "FanShopForecourt", Vector3.new(92, 1, 28), Vector3.new(-250, 0.7, -145), C.concrete, Enum.Material.Concrete)
part(shops, "CafePatio", Vector3.new(100, 1, 38), Vector3.new(230, 0.7, -170), C.concrete, Enum.Material.Concrete)
for _, x in ipairs({190, 230, 270}) do
	part(shops, "CafeTable", Vector3.new(12, 2, 12), Vector3.new(x, 3, -188), C.dark, Enum.Material.Wood)
	part(shops, "CafeSeat", Vector3.new(5, 3, 5), Vector3.new(x - 10, 2.5, -188), C.orange, Enum.Material.Wood)
end
building(shops, "CommunityHub", -90, 220, 74, 48, 24, C.concrete, "FAN HUB")

-- Mini pitch: flat court, markings, goals and fence
part(pitch, "MiniPitchSurface", Vector3.new(190, 2, 118), Vector3.new(-270, 1, -330), C.green, Enum.Material.Grass)
part(pitch, "PitchHalfwayLine", Vector3.new(2, 0.4, 112), Vector3.new(-270, 2.2, -330), C.white, Enum.Material.SmoothPlastic)
part(pitch, "PitchCentreCircle", Vector3.new(34, 0.4, 34), Vector3.new(-270, 2.25, -330), C.white, Enum.Material.SmoothPlastic)
part(pitch, "CentreCircleFill", Vector3.new(30, 0.5, 30), Vector3.new(-270, 2.5, -330), C.green, Enum.Material.Grass)
for _, z in ipairs({-388, -272}) do
	part(pitch, "GoalFrame", Vector3.new(3, 18, 28), Vector3.new(-270, 11, z), C.white, Enum.Material.Metal)
	part(pitch, "GoalNetBack", Vector3.new(3, 16, 24), Vector3.new(-283, 10, z), C.white, Enum.Material.Fabric)
end
for _, x in ipairs({-370, -170}) do
	part(pitch, "LowFence", Vector3.new(4, 12, 118), Vector3.new(x, 6, -330), C.dark, Enum.Material.Metal)
end
for _, z in ipairs({-395, -265}) do
	part(pitch, "LowFence", Vector3.new(204, 12, 4), Vector3.new(-270, 6, z), C.dark, Enum.Material.Metal)
end
sign(pitch, "MiniPitchSign", "MINI PITCH", Vector3.new(-270, 18, -408), Vector3.new(48, 10, 2), C.green)

-- Stadium forecourt and gates
part(forecourt, "ForecourtPaving", Vector3.new(230, 2, 150), Vector3.new(260, 1, 270), C.concrete, Enum.Material.Concrete)
sign(forecourt, "StadiumWelcome", "MATCHDAY STADIUM", Vector3.new(260, 25, 195), Vector3.new(84, 16, 2), C.red)
for i = -2, 2 do
	local x = 260 + i * 30
	part(forecourt, "EntryGate", Vector3.new(18, 24, 5), Vector3.new(x, 12, 215), C.dark, Enum.Material.Metal)
	part(forecourt, "GateHeader", Vector3.new(20, 4, 8), Vector3.new(x, 26, 215), C.orange, Enum.Material.Metal)
end

-- Main stadium shell, pitch and four simple stands
part(stadium, "StadiumOuterBase", Vector3.new(370, 8, 280), Vector3.new(270, 4, 0), C.dark, Enum.Material.Concrete)
part(stadium, "StadiumPitch", Vector3.new(210, 2, 126), Vector3.new(270, 9, 0), C.green, Enum.Material.Grass)
part(stadium, "PitchHalfway", Vector3.new(2, 0.3, 122), Vector3.new(270, 10.2, 0), C.white, Enum.Material.SmoothPlastic)
part(stadium, "PitchCentreMark", Vector3.new(28, 0.3, 28), Vector3.new(270, 10.25, 0), C.white, Enum.Material.SmoothPlastic)
part(stadium, "PitchCentreFill", Vector3.new(25, 0.4, 25), Vector3.new(270, 10.5, 0), C.green, Enum.Material.Grass)
part(stadium, "NorthStand", Vector3.new(330, 42, 42), Vector3.new(270, 25, 145), C.blue, Enum.Material.Concrete)
part(stadium, "SouthStand", Vector3.new(330, 42, 42), Vector3.new(270, 25, -145), C.red, Enum.Material.Concrete)
part(stadium, "WestStand", Vector3.new(42, 42, 220), Vector3.new(65, 25, 0), C.orange, Enum.Material.Concrete)
part(stadium, "EastStand", Vector3.new(42, 42, 220), Vector3.new(475, 25, 0), C.blue, Enum.Material.Concrete)
part(stadium, "NorthRoof", Vector3.new(350, 5, 48), Vector3.new(270, 48, 145), C.dark, Enum.Material.Metal)
part(stadium, "SouthRoof", Vector3.new(350, 5, 48), Vector3.new(270, 48, -145), C.dark, Enum.Material.Metal)
part(stadium, "WestRoof", Vector3.new(48, 5, 230), Vector3.new(65, 48, 0), C.dark, Enum.Material.Metal)
part(stadium, "EastRoof", Vector3.new(48, 5, 230), Vector3.new(475, 48, 0), C.dark, Enum.Material.Metal)
sign(stadium, "StadiumName", "THE HOME GROUND", Vector3.new(270, 58, 174), Vector3.new(110, 16, 2), C.red)

-- Repeating street furniture and fan-colour banners
for _, z in ipairs({70, 140}) do
	lamp(details, -170, z)
	lamp(details, -40, z)
	lamp(details, 90, z)
end
for _, x in ipairs({-190, -110, -30, 50, 130}) do
	banner(details, x, 105, (x % 2 == 0) and C.blue or C.orange)
end
for _, p in ipairs({
	Vector3.new(-90, 0, 20),
	Vector3.new(90, 0, 20),
	Vector3.new(190, 0, 250),
	Vector3.new(330, 0, 250),
}) do
	lamp(details, p.X, p.Z)
end

print("FootballFansMap generated. Zones: Arrival Plaza, Fan Street, Supporters' Square, Fan Shop, Café, Mini Pitch, Stadium Forecourt, Main Stadium.")

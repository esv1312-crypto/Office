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


-- Stadium detail pass: visible seating tiers, scoreboard, floodlights and entry arches.
local stadiumDetails = folder("StadiumDetails", stadium)

-- Seating rows on the four stands. Seats are intentionally grouped into simple
-- repeated blocks so this remains a lightweight greybox, not a high-poly stadium.
for row = 1, 10 do
	local zNorth = 120 - row * 4.5
	local zSouth = -120 + row * 4.5
	local y = 9 + row * 2.8
	for segment = 1, 10 do
		local x = 270 - 148 + (segment - 1) * 33
		part(stadiumDetails, "NorthStandSeatRow", Vector3.new(29, 2, 3), Vector3.new(x, y, zNorth), (segment % 2 == 0) and C.blue or C.orange, Enum.Material.Plastic)
		part(stadiumDetails, "SouthStandSeatRow", Vector3.new(29, 2, 3), Vector3.new(x, y, zSouth), (segment % 2 == 0) and C.red or C.orange, Enum.Material.Plastic)
	end
end

for row = 1, 10 do
	local xWest = 120 + row * 4.5
	local xEast = 420 - row * 4.5
	local y = 9 + row * 2.8
	for segment = 1, 6 do
		local z = -96 + (segment - 1) * 38
		part(stadiumDetails, "WestStandSeatRow", Vector3.new(3, 2, 32), Vector3.new(xWest, y, z), (segment % 2 == 0) and C.orange or C.blue, Enum.Material.Plastic)
		part(stadiumDetails, "EastStandSeatRow", Vector3.new(3, 2, 32), Vector3.new(xEast, y, z), (segment % 2 == 0) and C.blue or C.red, Enum.Material.Plastic)
	end
end

-- Scoreboard facing the centre of the pitch.
part(stadiumDetails, "ScoreboardFrame", Vector3.new(54, 30, 5), Vector3.new(270, 58, 126), C.dark, Enum.Material.Metal)
sign(stadiumDetails, "ScoreboardDisplay", "HOME  0  :  0  AWAY", Vector3.new(270, 59, 122), Vector3.new(48, 20, 2), C.green)

-- Goal frames at both ends of the main pitch.
for _, z in ipairs({-66, 66}) do
	part(stadiumDetails, "MainGoalFrame", Vector3.new(34, 18, 3), Vector3.new(270, 19, z), C.white, Enum.Material.Metal)
	part(stadiumDetails, "MainGoalNet", Vector3.new(30, 16, 3), Vector3.new(270, 18, z + (z > 0 and 13 or -13)), C.white, Enum.Material.Fabric)
end

-- Four floodlight masts outside the stadium corners.
for _, x in ipairs({55, 485}) do
	for _, z in ipairs({-155, 155}) do
		part(stadiumDetails, "FloodlightMast", Vector3.new(4, 82, 4), Vector3.new(x, 41, z), C.dark, Enum.Material.Metal)
		part(stadiumDetails, "FloodlightPanel", Vector3.new(18, 8, 5), Vector3.new(x, 82, z), C.white, Enum.Material.Neon)
	end
end

-- Exterior entry arches and turnstile blocks at the north approach.
local gates = folder("TurnstilesAndEntrances", forecourt)
for gate = 1, 5 do
	local x = 140 + (gate - 1) * 60
	part(gates, "GatePillarLeft", Vector3.new(5, 22, 5), Vector3.new(x - 12, 11, 185), C.dark, Enum.Material.Metal)
	part(gates, "GatePillarRight", Vector3.new(5, 22, 5), Vector3.new(x + 12, 11, 185), C.dark, Enum.Material.Metal)
	part(gates, "GateLintel", Vector3.new(30, 5, 6), Vector3.new(x, 22, 185), C.orange, Enum.Material.Metal)
	part(gates, "Turnstile", Vector3.new(8, 8, 8), Vector3.new(x, 4, 200), C.blue, Enum.Material.Metal)
end

-- Small public-space details: benches and planted islands around the square.
local publicRealm = folder("PublicRealmDetails", square)
for _, x in ipairs({-82, 82}) do
	part(publicRealm, "Planter", Vector3.new(24, 3, 24), Vector3.new(x, 2.5, -55), C.dark, Enum.Material.Concrete)
	part(publicRealm, "TreeTrunk", Vector3.new(4, 18, 4), Vector3.new(x, 13, -55), C.orange, Enum.Material.Wood)
	local crown = part(publicRealm, "TreeCrown", Vector3.new(20, 20, 20), Vector3.new(x, 30, -55), C.green, Enum.Material.Grass)
	crown.Shape = Enum.PartType.Ball
end


-- Neighbourhood life pass: shopfronts, street-facing facades, café interior,
-- fan posters, street art and a physical football for the first playtest.
local neighbourhood = folder("NeighbourhoodLife")
local storefronts = folder("FanStreetStorefronts", neighbourhood)
local cafeInterior = folder("CafeInterior", neighbourhood)
local fanCulture = folder("FanCultureDetails", neighbourhood)
local ballArea = folder("FootballProps", pitch)

local function windowPanel(parent, name, x, y, z, width, height, tint)
	local w = part(parent, name, Vector3.new(width, height, 1), Vector3.new(x, y, z), tint or C.glass, Enum.Material.Glass)
	w.Transparency = 0.18
	w.CanCollide = false
	return w
end

local function awning(parent, name, x, z, width, color)
	part(parent, name .. "Canopy", Vector3.new(width, 3, 12), Vector3.new(x, 15, z), color, Enum.Material.Fabric)
	for stripe = 1, 6 do
		local sx = x - width / 2 + stripe * (width / 7)
		part(parent, name .. "Stripe", Vector3.new(2, 3.2, 12.2), Vector3.new(sx, 15, z), C.white, Enum.Material.Fabric)
	end
end

local function poster(parent, name, text, x, y, z, color)
	local board = part(parent, name, Vector3.new(12, 16, 1), Vector3.new(x, y, z), color or C.orange, Enum.Material.SmoothPlastic)
	board.CanCollide = false
	local gui = Instance.new("SurfaceGui")
	gui.Face = Enum.NormalId.Front
	gui.SizingMode = Enum.SurfaceGuiSizingMode.PixelsPerStud
	gui.PixelsPerStud = 35
	gui.Parent = board
	local label = Instance.new("TextLabel")
	label.Size = UDim2.fromScale(1, 1)
	label.BackgroundTransparency = 1
	label.Text = text
	label.TextColor3 = C.white
	label.TextWrapped = true
	label.TextScaled = true
	label.Font = Enum.Font.GothamBold
	label.Parent = gui
end

-- A small row of independent neighbourhood buildings makes the main street
-- feel like a district rather than isolated points of interest.
building(storefronts, "ScarfAndBannerStore", -190, 185, 66, 48, 24, C.red, "SCARVES & FLAGS")
building(storefronts, "MatchdayDiner", 5, 185, 72, 50, 25, C.orange, "MATCHDAY DINER")
building(storefronts, "SupportersWorkshop", 190, 185, 68, 48, 24, C.blue, "FAN WORKSHOP")

-- Add readable street-facing shop windows, doors and striped awnings.
for _, shop in ipairs({
	{x = -190, z = 159, width = 66, colour = C.red},
	{x = 5, z = 158, width = 72, colour = C.orange},
	{x = 190, z = 159, width = 68, colour = C.blue},
}) do
	windowPanel(storefronts, "ShopWindowLeft", shop.x - 15, 10, shop.z, 18, 12)
	windowPanel(storefronts, "ShopWindowRight", shop.x + 15, 10, shop.z, 18, 12)
	part(storefronts, "ShopDoor", Vector3.new(9, 17, 2), Vector3.new(shop.x, 9, shop.z - 1), C.dark, Enum.Material.Metal)
	awning(storefronts, "ShopAwning", shop.x, shop.z - 7, shop.width, shop.colour)
end

-- Dress the original Fan Shop storefront with display bays and merchandise racks.
for _, x in ipairs({-273, -250, -227}) do
	windowPanel(shops, "FanShopDisplayWindow", x, 12, -130, 18, 13)
	part(shops, "MerchandiseDisplay", Vector3.new(12, 8, 5), Vector3.new(x, 5, -136), C.orange, Enum.Material.Fabric)
end
part(shops, "FanShopDoor", Vector3.new(10, 18, 2), Vector3.new(-250, 9, -131), C.dark, Enum.Material.Metal)
awning(shops, "FanShopAwning", -250, -139, 66, C.red)

-- Café interior: counter, tables, seats and warm pendant lights.
part(cafeInterior, "CafeFloor", Vector3.new(72, 1, 52), Vector3.new(230, 2, -120), C.dark, Enum.Material.WoodPlanks)
part(cafeInterior, "ServiceCounter", Vector3.new(42, 7, 8), Vector3.new(230, 6, -103), C.orange, Enum.Material.Wood)
part(cafeInterior, "CounterBackWall", Vector3.new(48, 18, 2), Vector3.new(230, 13, -91), C.concrete, Enum.Material.Concrete)
sign(cafeInterior, "CafeMenu", "COFFEE  •  FOOD  •  MATCHDAY", Vector3.new(230, 20, -93), Vector3.new(38, 8, 1), C.dark)
for _, x in ipairs({205, 230, 255}) do
	part(cafeInterior, "IndoorTable", Vector3.new(12, 2, 12), Vector3.new(x, 5, -133), C.orange, Enum.Material.Wood)
	for _, dx in ipairs({-8, 8}) do
		part(cafeInterior, "IndoorChair", Vector3.new(5, 5, 5), Vector3.new(x + dx, 3.5, -133), C.blue, Enum.Material.Wood)
	end
end
for _, x in ipairs({210, 250}) do
	part(cafeInterior, "PendantCable", Vector3.new(1, 7, 1), Vector3.new(x, 22, -112), C.dark, Enum.Material.Metal)
	local glow = part(cafeInterior, "PendantLamp", Vector3.new(5, 2, 5), Vector3.new(x, 18, -112), C.orange, Enum.Material.Neon)
	glow.CanCollide = false
end

-- Matchday posters and fictional fan-culture graphics.
poster(fanCulture, "MatchdayPoster", "MATCHDAY\nTOGETHER", -150, 13, 86, C.red)
poster(fanCulture, "FanZonePoster", "FAN ZONE\nOPEN TODAY", 145, 13, 86, C.blue)
poster(fanCulture, "MiniPitchPoster", "PLAY\nTOGETHER", -355, 13, -260, C.green)
part(fanCulture, "StreetArtWall", Vector3.new(52, 18, 2), Vector3.new(-90, 12, 176), C.dark, Enum.Material.Concrete)
sign(fanCulture, "StreetArtMessage", "ONE CITY  •  ONE CROWD", Vector3.new(-90, 15, 174), Vector3.new(44, 10, 1), C.orange)

-- A physical ball gives the first Roblox Studio inspection something interactive.
local football = Instance.new("Part")
football.Name = "MatchBall"
football.Shape = Enum.PartType.Ball
football.Size = Vector3.new(5, 5, 5)
football.Position = Vector3.new(-270, 7, -330)
football.Anchored = false
football.CanCollide = true
football.Material = Enum.Material.SmoothPlastic
football.Color = C.white
football.CustomPhysicalProperties = PhysicalProperties.new(0.7, 0.35, 0.55)
football.Parent = ballArea


-- Open the café front so its interior props are visible and players can enter.
-- Replace the original solid placeholder volume with a simple four-wall shell.
local cafeModel = shops:FindFirstChild("SupportersCafe")
if cafeModel then
	local solidVolume = cafeModel:FindFirstChild("MainVolume")
	if solidVolume then solidVolume:Destroy() end
	local frontWindows = cafeModel:FindFirstChild("FrontWindowBand")
	if frontWindows then frontWindows:Destroy() end
	part(cafeModel, "CafeLeftWall", Vector3.new(4, 30, 62), Vector3.new(189, 15, -120), C.blue, Enum.Material.Concrete)
	part(cafeModel, "CafeRightWall", Vector3.new(4, 30, 62), Vector3.new(271, 15, -120), C.blue, Enum.Material.Concrete)
	part(cafeModel, "CafeBackWall", Vector3.new(82, 30, 4), Vector3.new(230, 15, -89), C.blue, Enum.Material.Concrete)
	part(cafeModel, "CafeFrontLeftPier", Vector3.new(20, 26, 4), Vector3.new(199, 13, -151), C.blue, Enum.Material.Concrete)
	part(cafeModel, "CafeFrontRightPier", Vector3.new(20, 26, 4), Vector3.new(261, 13, -151), C.blue, Enum.Material.Concrete)
	part(cafeModel, "CafeFrontHeader", Vector3.new(82, 4, 4), Vector3.new(230, 28, -151), C.dark, Enum.Material.Metal)
	windowPanel(cafeModel, "CafeFrontGlassLeft", 211, 13, -153, 14, 19)
	windowPanel(cafeModel, "CafeFrontGlassRight", 249, 13, -153, 14, 19)
end


-- Ambient supporter crowd: lightweight anchored character stand-ins.
-- These are visual NPC prototypes; pathfinding, dialogue and emote animation
-- are intentionally deferred until the first Roblox Studio playtest.
local socialLife = folder("SocialLife")
local crowd = folder("AmbientSupporters", socialLife)
local fanMerch = folder("ScarvesAndFlags", socialLife)
local meetups = folder("MeetupSpots", socialLife)

local function makeSupporter(name, x, z, shirtColor, scarfColor, greeting)
	local model = Instance.new("Model")
	model.Name = name
	model.Parent = crowd

	local torso = part(model, "Torso", Vector3.new(5, 8, 3), Vector3.new(x, 9, z), shirtColor, Enum.Material.Fabric)
	local head = part(model, "Head", Vector3.new(4, 4, 4), Vector3.new(x, 15, z), Color3.fromRGB(224, 185, 148), Enum.Material.SmoothPlastic)
	part(model, "LeftLeg", Vector3.new(2.5, 7, 2.5), Vector3.new(x - 1.35, 2.5, z), C.dark, Enum.Material.Fabric)
	part(model, "RightLeg", Vector3.new(2.5, 7, 2.5), Vector3.new(x + 1.35, 2.5, z), C.dark, Enum.Material.Fabric)
	part(model, "LeftArm", Vector3.new(2.2, 7, 2.2), Vector3.new(x - 3.6, 9, z), shirtColor, Enum.Material.Fabric)
	part(model, "RightArm", Vector3.new(2.2, 7, 2.2), Vector3.new(x + 3.6, 9, z), shirtColor, Enum.Material.Fabric)
	part(model, "Scarf", Vector3.new(5.4, 1.5, 3.3), Vector3.new(x, 12.1, z - 0.15), scarfColor, Enum.Material.Fabric)
	part(model, "ScarfTail", Vector3.new(1.5, 5, 1), Vector3.new(x + 1.6, 9.4, z - 1.8), scarfColor, Enum.Material.Fabric)
	part(model, "Cap", Vector3.new(4.5, 1.2, 4.5), Vector3.new(x, 17.4, z), scarfColor, Enum.Material.Fabric)
	model.PrimaryPart = torso

	local bubble = Instance.new("BillboardGui")
	bubble.Name = "Greeting"
	bubble.Adornee = head
	bubble.Size = UDim2.fromOffset(150, 38)
	bubble.StudsOffset = Vector3.new(0, 3.2, 0)
	bubble.AlwaysOnTop = false
	bubble.Parent = head
	local textLabel = Instance.new("TextLabel")
	textLabel.Size = UDim2.fromScale(1, 1)
	textLabel.BackgroundColor3 = C.dark
	textLabel.BackgroundTransparency = 0.15
	textLabel.TextColor3 = C.white
	textLabel.Text = greeting
	textLabel.TextScaled = true
	textLabel.Font = Enum.Font.GothamBold
	textLabel.Parent = bubble
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 8)
	corner.Parent = textLabel
	return model
end

-- Supporters gathering around the social square.
makeSupporter("BlueScarfSupporter", -48, -20, C.blue, C.orange, "COME ON!")
makeSupporter("OrangeScarfSupporter", -18, -35, C.orange, C.blue, "HELLO, FRIEND!")
makeSupporter("GreenScarfSupporter", 22, -22, C.green, C.white, "MATCHDAY!")
makeSupporter("RedScarfSupporter", 54, 15, C.red, C.white, "WELCOME!")

-- Small groups near the mini pitch and the stadium approach.
makeSupporter("PitchSupporterOne", -390, -310, C.blue, C.white, "NICE PASS!")
makeSupporter("PitchSupporterTwo", -150, -300, C.red, C.white, "YOUR TURN!")
makeSupporter("StadiumSupporterOne", 190, 300, C.orange, C.blue, "THIS WAY!")
makeSupporter("StadiumSupporterTwo", 330, 300, C.blue, C.orange, "SEE YOU INSIDE!")

-- A simple scarf rack and flag display outside the Fan Shop.
part(fanMerch, "ScarfRack", Vector3.new(34, 3, 5), Vector3.new(-250, 5, -158), C.dark, Enum.Material.Metal)
for i, color in ipairs({C.blue, C.orange, C.red, C.green, C.white}) do
	local x = -266 + (i - 1) * 8
	part(fanMerch, "HangingScarf", Vector3.new(5, 14, 1), Vector3.new(x, 13, -158), color, Enum.Material.Fabric)
end
for i, color in ipairs({C.blue, C.orange, C.red}) do
	local x = -292 + (i - 1) * 42
	part(fanMerch, "FlagPole", Vector3.new(1, 22, 1), Vector3.new(x, 11, -178), C.dark, Enum.Material.Metal)
	part(fanMerch, "SupporterFlag", Vector3.new(1, 12, 18), Vector3.new(x + 7, 14, -178), color, Enum.Material.Fabric)
end
sign(fanMerch, "FanColoursSign", "PICK YOUR COLOURS", Vector3.new(-250, 24, -184), Vector3.new(52, 9, 2), C.orange)

-- Marked gathering spots give groups a natural place to meet.
for _, spot in ipairs({
	{name = "SquareMeetup", x = 82, z = -52, color = C.blue, label = "MEET HERE"},
	{name = "PitchMeetup", x = -270, z = -405, color = C.green, label = "TEAM UP"},
	{name = "StadiumMeetup", x = 390, z = 270, color = C.orange, label = "MEET YOUR CREW"},
}) do
	local pad = part(meetups, spot.name, Vector3.new(28, 1, 28), Vector3.new(spot.x, 2, spot.z), spot.color, Enum.Material.Neon)
	pad.Transparency = 0.25
	sign(meetups, spot.name .. "Sign", spot.label, Vector3.new(spot.x, 10, spot.z - 17), Vector3.new(32, 7, 1), spot.color)
end


-- Fan shop interactions: each scarf display is a proximity-based team choice.
local fanGroupPalette = {
	{name = "Blue Crew", brick = "Bright blue", color = C.blue, prompt = "Join Blue Crew"},
	{name = "Orange Crew", brick = "Bright orange", color = C.orange, prompt = "Join Orange Crew"},
	{name = "Red Crew", brick = "Bright red", color = C.red, prompt = "Join Red Crew"},
	{name = "Green Crew", brick = "Bright green", color = C.green, prompt = "Join Green Crew"},
	{name = "White Crew", brick = "Institutional white", color = C.white, prompt = "Join White Crew"},
}
local scarfDisplays = {}
for _, item in ipairs(fanGroupPalette) do
	local display = part(fanMerch, "HangingScarf", Vector3.new(5, 14, 1), Vector3.new(-266 + (#scarfDisplays) * 8, 13, -158), item.color, Enum.Material.Fabric)
	display:SetAttribute("FanGroupName", item.name)
	display:SetAttribute("FanGroupBrickColor", item.brick)
	display:SetAttribute("FanGroupColor", item.color)
	local prompt = Instance.new("ProximityPrompt")
	prompt.Name = "ChooseFanGroup"
	prompt.ActionText = item.prompt
	prompt.ObjectText = "Supporter scarf"
	prompt.HoldDuration = 0.35
	prompt.MaxActivationDistance = 11
	prompt.RequiresLineOfSight = false
	prompt.Parent = display
	table.insert(scarfDisplays, display)
end

-- Meetup pads get a simple cheer interaction. The runtime script below handles
-- the animation so the generated map remains a self-contained prototype.
for _, padName in ipairs({"SquareMeetup", "PitchMeetup", "StadiumMeetup"}) do
	local pad = meetups:FindFirstChild(padName)
	if pad then
		local prompt = Instance.new("ProximityPrompt")
		prompt.Name = "GroupCheer"
		prompt.ActionText = "Cheer together"
		prompt.ObjectText = "Supporters meetup"
		prompt.HoldDuration = 0.25
		prompt.MaxActivationDistance = 12
		prompt.RequiresLineOfSight = false
		prompt.Parent = pad
	end
end

-- Install one small server runtime. It only manages this map's team choice,
-- wearable scarf visuals and meetup cheer prompts.
local ServerScriptService = game:GetService("ServerScriptService")
local previousRuntime = ServerScriptService:FindFirstChild("FootballFansSocialRuntime")
if previousRuntime then previousRuntime:Destroy() end
local runtimeScript = Instance.new("Script")
runtimeScript.Name = "FootballFansSocialRuntime"
runtimeScript.Source = [=[
local Players = game:GetService("Players")
local Teams = game:GetService("Teams")
local TweenService = game:GetService("TweenService")

local palette = {
	["Blue Crew"] = {brick = "Bright blue", color = Color3.fromRGB(48, 112, 176)},
	["Orange Crew"] = {brick = "Bright orange", color = Color3.fromRGB(225, 122, 48)},
	["Red Crew"] = {brick = "Bright red", color = Color3.fromRGB(184, 61, 61)},
	["Green Crew"] = {brick = "Bright green", color = Color3.fromRGB(48, 133, 75)},
	["White Crew"] = {brick = "Institutional white", color = Color3.fromRGB(238, 239, 232)},
}
local cooldowns = {}

for teamName, data in pairs(palette) do
	local team = Teams:FindFirstChild(teamName)
	if not team then
		team = Instance.new("Team")
		team.Name = teamName
		team.Parent = Teams
	end
	team.TeamColor = BrickColor.new(data.brick)
	team.AutoAssignable = false
end

local function applyScarf(player, character)
	local groupName = player:GetAttribute("FanGroup")
	local data = groupName and palette[groupName]
	if not data then return end

	local torso = character:FindFirstChild("UpperTorso") or character:FindFirstChild("Torso")
	if not torso then
		torso = character:WaitForChild("HumanoidRootPart", 5)
	end
	if not torso then return end

	local old = character:FindFirstChild("FanScarfVisual")
	if old then old:Destroy() end
	local visual = Instance.new("Folder")
	visual.Name = "FanScarfVisual"
	visual.Parent = character

	local band = Instance.new("Part")
	band.Name = "ScarfBand"
	band.Size = Vector3.new(2.5, 0.32, 0.28)
	band.Color = data.color
	band.Material = Enum.Material.Fabric
	band.CanCollide = false
	band.CanTouch = false
	band.CanQuery = false
	band.Massless = true
	band.Anchored = false
	band.CFrame = torso.CFrame * CFrame.new(0, 0.28, -0.52)
	band.Parent = visual
	local bandWeld = Instance.new("WeldConstraint")
	bandWeld.Part0 = torso
	bandWeld.Part1 = band
	bandWeld.Parent = band

	local tail = Instance.new("Part")
	tail.Name = "ScarfTail"
	tail.Size = Vector3.new(0.32, 1.25, 0.2)
	tail.Color = data.color
	tail.Material = Enum.Material.Fabric
	tail.CanCollide = false
	tail.CanTouch = false
	tail.CanQuery = false
	tail.Massless = true
	tail.Anchored = false
	tail.CFrame = torso.CFrame * CFrame.new(0.78, -0.48, -0.54)
	tail.Parent = visual
	local tailWeld = Instance.new("WeldConstraint")
	tailWeld.Part0 = torso
	tailWeld.Part1 = tail
	tailWeld.Parent = tail
end

local function selectFanGroup(player, display)
	local groupName = display:GetAttribute("FanGroupName")
	local data = groupName and palette[groupName]
	if not data then return end
	local team = Teams:FindFirstChild(groupName)
	if not team then return end

	player:SetAttribute("FanGroup", groupName)
	player.Team = team
	player.Neutral = false
	if player.Character then
		applyScarf(player, player.Character)
	end
end

local function cheer(player)
	local now = os.clock()
	if cooldowns[player] and now - cooldowns[player] < 3 then return end
	cooldowns[player] = now

	local character = player.Character
	if not character then return end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not humanoid or humanoid.Health <= 0 then return end

	local joints = {}
	for _, joint in ipairs(character:GetDescendants()) do
		if joint:IsA("Motor6D") and (joint.Name == "RightShoulder" or joint.Name == "Right Shoulder" or joint.Name == "LeftShoulder" or joint.Name == "Left Shoulder") then
			table.insert(joints, {joint = joint, original = joint.C0})
		end
	end
	if #joints == 0 then return end

	local tweens = {}
	for _, item in ipairs(joints) do
		local direction = (string.find(item.joint.Name, "Left") and -1) or 1
		local target = item.original * CFrame.Angles(0, 0, math.rad(135 * direction))
		local tween = TweenService:Create(item.joint, TweenInfo.new(0.28, Enum.EasingStyle.Back, Enum.EasingDirection.Out), {C0 = target})
		table.insert(tweens, {tween = tween, joint = item.joint, original = item.original})
		tween:Play()
	end
	task.delay(0.65, function()
		for _, item in ipairs(tweens) do
			if item.joint and item.joint.Parent then
				TweenService:Create(item.joint, TweenInfo.new(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {C0 = item.original}):Play()
			end
		end
	end)
end

local map = workspace:WaitForChild("FootballFansMap", 15)
if not map then return end
local merch = map:FindFirstChild("ScarvesAndFlags", true)
if merch then
	for _, display in ipairs(merch:GetChildren()) do
		if display:IsA("BasePart") and display.Name == "HangingScarf" then
			local prompt = display:FindFirstChild("ChooseFanGroup")
			if prompt then
				prompt.Triggered:Connect(function(player)
					selectFanGroup(player, display)
				end)
			end
		end
	end
end

local meetups = map:FindFirstChild("MeetupSpots", true)
if meetups then
	for _, pad in ipairs(meetups:GetChildren()) do
		local prompt = pad:FindFirstChild("GroupCheer")
		if prompt then
			prompt.Triggered:Connect(cheer)
		end
	end
end

local function setupPlayer(player)
	player.CharacterAdded:Connect(function(character)
		task.wait(0.25)
		applyScarf(player, character)
	end)
	if player.Character then
		task.spawn(applyScarf, player, player.Character)
	end
end

Players.PlayerAdded:Connect(setupPlayer)
Players.PlayerRemoving:Connect(function(player) cooldowns[player] = nil end)
for _, player in ipairs(Players:GetPlayers()) do setupPlayer(player) end
]=]
runtimeScript.Parent = ServerScriptService

print("FootballFansMap generated. Zones: Arrival Plaza, Fan Street, Supporters' Square, Fan Shop, Café, Mini Pitch, Stadium Forecourt, Main Stadium.")

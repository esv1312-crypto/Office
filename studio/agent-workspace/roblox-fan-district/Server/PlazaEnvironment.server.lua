--[[
	Fan Plaza Environment
	Central plaza area with various sections and amenities
	Location: Workspace.FanPlaza
]]

local Workspace = game:GetService("Workspace")

-- Create the main plaza area
local function createFanPlaza()
	-- Main plaza floor
	local plazaFloor = Instance.new("Part")
	plazaFloor.Name = "FanPlazaFloor"
	plazaFloor.Size = Vector3.new(100, 2, 100)
	plazaFloor.Position = Vector3.new(0, 0, 0)
	plazaFloor.Anchored = true
	plazaFloor.CanCollide = true
	plazaFloor.BrickColor = BrickColor.new("Dark stone grey")
	plazaFloor.Material = Enum.Material.Plain
	plazaFloor.Parent = Workspace
	
	-- Plaza border/walls
	local createWall = function(name, position, size, rotation)
		local wall = Instance.new("Part")
		wall.Name = name
		wall.Size = size
		wall.Position = position
		wall.Anchored = true
		wall.CanCollide = true
		wall.BrickColor = BrickColor.new("Navy blue")
		wall.Material = Enum.Material.Concrete
		wall.Parent = Workspace
		if rotation then
			wall.CFrame = CFrame.Angles(0, rotation, 0)
		end
		return wall
	end
	
	-- Create border walls around the plaza
	createWall("NorthWall", Vector3.new(0, 1, -50), Vector3.new(100, 4, 2))
	createWall("SouthWall", Vector3.new(0, 1, 50), Vector3.new(100, 4, 2), math.rad(180))
	createWall("EastWall", Vector3.new(50, 1, 0), Vector3.new(2, 4, 100), math.rad(90))
	createWall("WestWall", Vector3.new(-50, 1, 0), Vector3.new(2, 4, 100), math.rad(-90))
	
	-- Create plaza center area (slightly raised)
	local centerPlatform = Instance.new("Part")
	centerPlatform.Name = "CenterPlatform"
	centerPlatform.Size = Vector3.new(20, 1, 20)
	centerPlatform.Position = Vector3.new(0, 1, 0)
	centerPlatform.Anchored = true
	centerPlatform.CanCollide = true
	centerPlatform.BrickColor = BrickColor.new("Bright blue")
	centerPlatform.Material = Enum.Material.Neon
	centerPlatform.Transparency = 0.5
	centerPlatform.Parent = Workspace
	
	-- Create seating areas around the plaza
	local createSeatingArea = function(name, position, rotation)
		local base = Instance.new("Part")
		base.Name = name
		base.Size = Vector3.new(8, 1, 8)
		base.Position = position
		base.Anchored = true
		base.CanCollide = true
		base.BrickColor = BrickColor.new("Forest green")
		base.Material = Enum.Material.Grass
		base.Parent = Workspace
		
		-- Add seats around the seating area
		for i = 1, 4 do
			local angle = math.rad(i * 90)
			local seat = Instance.new("Part")
			seat.Name = "Seat" .. i
			seat.Size = Vector3.new(2, 0.5, 2)
			seat.Position = position + Vector3.new(math.cos(angle) * 3, 0.5, math.sin(angle) * 3)
			seat.Anchored = true
			seat.CanCollide = true
			seat.BrickColor = BrickColor.new("Brown")
			seat.Material = Enum.Material.Wood
			seat.Parent = Workspace
			if rotation then
				seat.CFrame = CFrame.Angles(0, rotation, 0)
			end
		end
		return base
	end
	
	-- Create seating areas at cardinal directions
	createSeatingArea("NorthSeating", Vector3.new(0, 0, 30), math.rad(0))
	createSeatingArea("SouthSeating", Vector3.new(0, 0, -30), math.rad(180))
	createSeatingArea("EastSeating", Vector3.new(30, 0, 0), math.rad(90))
	createSeatingArea("WestSeating", Vector3.new(-30, 0, 0), math.rad(-90))
	
	-- Create flag poles at corners
	local createFlagPole = function(name, position)
		local pole = Instance.new("Part")
		pole.Name = name
		pole.Size = Vector3.new(0.5, 15, 0.5)
		pole.Position = position
		pole.Anchored = true
		pole.CanCollide = false
		pole.BrickColor = BrickColor.new("Yellow")
		pole.Material = Enum.Material.Neon
		pole.Parent = Workspace
		
		-- Add flag (simple part for now)
		local flag = Instance.new("Part")
		flag.Name = "Flag"
		flag.Size = Vector3.new(1, 0.5, 3)
		flag.Position = position + Vector3.new(0, 7.5, 0)
		flag.Anchored = true
		flag.CanCollide = false
		flag.BrickColor = BrickColor.new("Red")
		flag.Material = Enum.Material.Foil
		flag.Parent = Workspace
		return pole
	end
	
	createFlagPole("NorthFlagPole", Vector3.new(0, 7.5, -50))
	createFlagPole("SouthFlagPole", Vector3.new(0, 7.5, 50))
	createFlagPole("EastFlagPole", Vector3.new(50, 7.5, 0))
	createFlagPole("WestFlagPole", Vector3.new(-50, 7.5, 0))
	
	-- Create information kiosks
	local createKiosk = function(name, position)
		local kiosk = Instance.new("Part")
		kiosk.Name = name
		kiosk.Size = Vector3.new(4, 3, 4)
		kiosk.Position = position
		kiosk.Anchored = true
		kiosk.CanCollide = true
		kiosk.BrickColor = BrickColor.new("Light grey")
		kiosk.Material = Enum.Material.Concrete
		kiosk.Parent = Workspace
		
		-- Add sign
		local sign = Instance.new("Part")
		sign.Name = "Sign"
		sign.Size = Vector3.new(3, 0.5, 1)
		sign.Position = position + Vector3.new(0, 1.75, 2)
		sign.Anchored = true
		sign.CanCollide = false
		sign.BrickColor = BrickColor.new("White")
		sign.Material = Enum.Material.Neon
		sign.Parent = Workspace
		return kiosk
	end
	
	createKiosk("NorthKiosk", Vector3.new(0, 0, -45))
	createKiosk("SouthKiosk", Vector3.new(0, 0, 45))
	
	-- Create lighting for the plaza
	local createLight = function(name, position)
		local light = Instance.new("PointLight")
		light.Name = name
		light.Position = position
		light.Color = Color3.new(1, 1, 0.9)
		light.Brightness = 1
		light.Range = 50
		light.Shadows = true
		light.Parent = Workspace
		return light
	end
	
	-- Add ambient lighting
	for x = -40, 40, 20 do
		for z = -40, 40, 20 do
			createLight("PlazaLight" .. x .. z, Vector3.new(x, 15, z))
		end
	end
	
	-- Create a central fountain (optional visual element)
	local fountain = Instance.new("Part")
	fountain.Name = "FountainBase"
	fountain.Size = Vector3.new(6, 1, 6)
	fountain.Position = Vector3.new(0, 0.5, 0)
	fountain.Anchored = true
	fountain.CanCollide = true
	fountain.BrickColor = BrickColor.new("White")
	fountain.Material = Enum.Material.Glass
	fountain.Transparency = 0.7
	fountain.Parent = Workspace
	
	print("[FanPlaza] Plaza environment created")
end

-- Initialize the plaza
createFanPlaza()

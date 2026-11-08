-- Server/PlazaSetup.lua
-- Creates the fan plaza area and a spawn location in the workspace.

local PlazaSetup = {}

function PlazaSetup.createPlaza()
	local workspace = game:GetService("Workspace")

	-- Create the plaza floor
	local floor = Instance.new("Part")
	floor.Name = "PlazaFloor"
	floor.Size = Vector3.new(200, 4, 200)
	floor.Position = Vector3.new(0, 2, 0)
	floor.Color = Color3.fromRGB(255, 255, 255)
	floor.Material = Enum.Material.Concrete
	floor.Anchored = true
	floor.Parent = workspace

	-- Create a ring of wall parts around the plaza
	for i = 1, 8 do
		local angle = (i - 1) * (math.pi * 2 / 8)
		local x = math.cos(angle) * 90
		local z = math.sin(angle) * 90
		local wall = Instance.new("Part")
		wall.Name = "PlazaWall"
		wall.Size = Vector3.new(12, 8, 8)
		wall.Position = Vector3.new(x, 4, z)
		wall.Color = Color3.fromRGB(100, 100, 100)
		wall.Material = Enum.Material.Grass
		wall.Anchored = true
		wall.Parent = workspace
	end

	-- Create the player spawn location at the plaza center
	local spawn = Instance.new("SpawnLocation")
	spawn.Name = "PlazaSpawn"
	spawn.Position = Vector3.new(0, 2, 0)
	spawn.Size = Vector3.new(4, 4, 4)
	spawn.TeamColor = BrickColor.new("Really red")
	spawn.AllowTeamChangeOnTouch = false
	spawn.RespawnTime = 0
	spawn.Parent = workspace

	print("Plaza setup complete.")
end

-- Run the setup immediately when the script loads
PlazaSetup.createPlaza()

return PlazaSetup
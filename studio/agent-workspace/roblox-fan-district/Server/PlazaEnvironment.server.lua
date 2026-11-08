-- PlazaEnvironment.server.lua
-- Creates the central fan plaza area with appropriate parts and a designated spawn location

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

-- Plaza configuration
local PLAZA_CONFIG = {
    CenterPosition = Vector3.new(0, 50, 0),  -- Center of the plaza (elevated)
    Size = Vector3.new(100, 2, 100),        -- Width, Height, Depth
    FloorMaterial = Enum.Material.Concrete,
    FloorColor = Color3.new(0.2, 0.2, 0.25),
    SpawnPadSize = Vector3.new(20, 1, 20),
    SpawnPadMaterial = Enum.Material.Neon,
    SpawnPadColor = Color3.new(0, 0.8, 1),
}

-- Create the fan plaza environment
local function createPlaza()
    -- Create main floor
    local floor = Instance.new("Part")
    floor.Name = "PlazaFloor"
    floor.Size = PLAZA_CONFIG.Size
    floor.Position = PLAZA_CONFIG.CenterPosition
    floor.Material = PLAZA_CONFIG.FloorMaterial
    floor.Color = PLAZA_CONFIG.FloorColor
    floor.Anchored = true
    floor.Parent = Workspace

    -- Create spawn pad at center
    local spawnPad = Instance.new("Part")
    spawnPad.Name = "SpawnPad"
    spawnPad.Size = PLAZA_CONFIG.SpawnPadSize
    spawnPad.Position = PLAZA_CONFIG.CenterPosition
    spawnPad.Material = PLAZA_CONFIG.SpawnPadMaterial
    spawnPad.Color = PLAZA_CONFIG.SpawnPadColor
    spawnPad.Anchored = true
    spawnPad.Parent = Workspace

    -- Create a HumanoidRootPart placeholder for spawn location
    -- (The actual spawn location is set via the SpawnHandler when players join)
    
    return PLAZA_CONFIG.CenterPosition
end

-- Initialize the plaza when the server starts
local spawnCenter = createPlaza()

-- Store spawn center in a global for other scripts to access
game:GetService("ReplicatedStorage"):SetAttribute("PlazaCenter", spawnCenter)

print("Fan Plaza environment created at center:", spawnCenter)
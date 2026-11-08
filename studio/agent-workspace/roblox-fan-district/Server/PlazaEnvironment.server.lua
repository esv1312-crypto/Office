-- Fan Plaza Environment
-- Creates the fan plaza area in the workspace with appropriate parts

local plaza = Instance.new("Part")
plaza.Shape = Enum.PartType.Box
plaza.Size = Vector3.new(20, 5, 20) -- 20x5x20 studs
plaza.Position = Vector3.new(0, 10, 0) -- Center of the plaza
plaza.Anchored = true
plaza.Parent = workspace

-- Create decorative elements around the plaza
local decorativeParts = {
    {Size = Vector3.new(3, 1, 3), Color = Color3.fromRGB(255, 200, 100), Name = "Decor1"},
    {Size = Vector3.new(3, 1, 3), Color = Color3.fromRGB(200, 255, 100), Name = "Decor2"},
    {Size = Vector3.new(3, 1, 3), Color = Color3.fromRGB(100, 200, 255), Name = "Decor3"},
}

for i, partData in ipairs(decorativeParts) do
    local part = Instance.new("Part")
    part.Size = partData.Size
    part.Color = partData.Color
    part.Anchored = true
    part.Parent = workspace
    -- Position decorators around the plaza center
    part.Position = Vector3.new(
        (math.random() - 0.5) * 10,
        0,
        (math.random() - 0.5) * 10
    )
end

-- Create a central pedestal for the fan plaza
local pedestal = Instance.new("Part")
pedestal.Shape = Enum.PartType.Ball
pedestal.Size = Vector3.new(3, 3, 3)
pedestal.Position = Vector3.new(0, 5, 0)
pedestal.Anchored = true
pedestal.Parent = workspace

print("Fan Plaza environment created successfully")
print("Plaza position: " .. plaza.Position)
print("Pedestal position: " .. pedestal.Position)

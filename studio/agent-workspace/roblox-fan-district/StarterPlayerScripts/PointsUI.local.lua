-- Client-side Points UI
-- Demonstrates how to interact with the server-authoritative points system

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer

-- Get RemoteEvents
local remotesFolder = ReplicatedStorage:WaitForChild("PointsRemotes")
local cheerRemote = remotesFolder:WaitForChild("Cheer")
local collectItemRemote = remotesFolder:WaitForChild("CollectItem")
local getPointsRemote = remotesFolder:WaitForChild("GetPoints")

-- UI Elements
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "PointsUI"
screenGui.Parent = player:WaitForChild("PlayerGui")

-- Points display
local frame = Instance.new("Frame")
frame.Name = "PointsFrame"
frame.Size = UDim2.new(0, 200, 0, 100)
frame.Position = UDim2.new(0, 10, 0, 10)
frame.BackgroundTransparency = 0.5
frame.BackgroundColor3 = Color3.new(0, 0, 0)
frame.Parent = screenGui

local pointsLabel = Instance.new("TextBox")
pointsLabel.Name = "PointsLabel"
pointsLabel.Size = UDim2.new(1, 0, 0, 40)
pointsLabel.Position = UDim2.new(0, 0, 0, 0)
pointsLabel.BackgroundTransparency = 1
pointsLabel.Text = "Points: 0"
pointsLabel.TextColor3 = Color3.new(1, 1, 1)
pointsLabel.Font = Enum.Font.GothamBold
pointsLabel.TextSize = 20
pointsLabel.Parent = frame

-- Cheer button
local cheerButton = Instance.new("TextButton")
cheerButton.Name = "CheerButton"
cheerButton.Size = UDim2.new(0.8, 0, 0, 40)
cheerButton.Position = UDim2.new(0.1, 0, 0, 50)
cheerButton.Text = "Cheer! (+10 pts)"
cheerButton.Font = Enum.Font.Gotham
cheerButton.TextSize = 16
cheerButton.Parent = frame

-- Collect button (simulates collecting an item)
local collectButton = Instance.new("TextButton")
collectButton.Name = "CollectButton"
collectButton.Size = UDim2.new(0.8, 0, 0, 40)
collectButton.Position = UDim2.new(0.1, 0, 0, 0)
collectButton.Text = "Collect Item (+25 pts)"
collectButton.Font = Enum.Font.Gotham
collectButton.TextSize = 16
collectButton.Parent = frame

-- Update points display
local function updatePointsDisplay(points)
	pointsLabel.Text = string.format("Points: %d", points)
end

-- Initialize by querying server
local success, currentPoints = pcall(function()
	return getPointsRemote:InvokeServer()
end)

if success and currentPoints then
	updatePointsDisplay(currentPoints)
else
	warn("[PointsUI] Failed to get initial points")
end

-- Cheer button handler
cheerButton.MouseButton1Click:Connect(function()
	print("[PointsUI] Sending Cheer request to server...")
	cheerRemote:FireServer()
	
	-- Wait for server response with updated points
	-- The server will FireClient with the new total
end)

-- Collect item button handler
collectButton.MouseButton1Click:Connect(function()
	print("[PointsUI] Sending CollectItem request to server...")
	collectItemRemote:FireServer("item_gold")
end)

-- Listen for points updates from server
cheerRemote.OnClientEvent:Connect(function(newPoints)
	print(string.format("[PointsUI] Received points update: %d", newPoints))
	updatePointsDisplay(newPoints)
end)

collectItemRemote.OnClientEvent:Connect(function(newPoints, itemId)
	print(string.format("[PointsUI] Received collect update: %d points (item: %s)", newPoints, itemId))
	updatePointsDisplay(newPoints)
end)

-- Auto-refresh points periodically
local refreshInterval = 5 -- seconds
spawn(function()
	while wait(refreshInterval) do
		local success, currentPoints = pcall(function()
			return getPointsRemote:InvokeServer()
		end)
		if success and currentPoints then
			updatePointsDisplay(currentPoints)
		end
	end
end)

print("[PointsUI] Client-side points UI initialized")
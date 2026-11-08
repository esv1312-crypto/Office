-- StarterPlayerScripts/SpawnController.lua
-- Client-side spawn controller for player character handling.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")

local SpawnController = {}

function SpawnController.onPlayerAdded(player)
	-- If this player is local, wait for character and apply visual effects
	if player == Players.LocalPlayer then
		local playerGui = Players.LocalPlayer:FindFirstChild("PlayerGui")
		if not playerGui then
			playerGui = Instance.new("PlayerGui")
			playerGui.Name = "PlayerGui"
			Players.LocalPlayer.Parent = playerGui
		end

		-- Wait for character to load
		local character = Players.LocalPlayer.Character or Players.LocalPlayer.CharacterAdded:Wait()
		local humanoid = character:FindFirstChild("Humanoid")
		if humanoid then
			humanoid.DisplayDistanceType = Enum.HumanoidDisplayDistanceType.None
			humanoid.WalkSpeed = 16
		end
		
		-- Create a simple billboard for the player name above the character
		local billboard = Instance.new("BillboardGui")
		billboard.Name = "PlayerNameBillboard"
		billboard.Size = UDim2.new(0, 100, 0, 20)
		billboard.StudsOffset = Vector3.new(0, 2, 0)
		billboard.AlwaysOnTop = true
		billboard.Parent = character
		
		local nameLabel = Instance.new("TextLabel")
		nameLabel.Text = Players.LocalPlayer.Name
		nameLabel.Font = Enum.Font.SourceSansBold
		nameLabel.TextSize = 14
		nameLabel.TextColor3 = Color3.new(1, 1, 1)
		nameLabel.BackgroundTransparency = 1
		nameLabel.Size = UDim2.new(1, 0, 1, 0)
		nameLabel.Parent = billboard
		
		print("SpawnController initialized for local player.")
	end
end

function SpawnController.onPlayerRemoving(player)
	-- Clean up local player GUI if needed
	if player == Players.LocalPlayer then
		local playerGui = Players.LocalPlayer:FindFirstChild("PlayerGui")
		if playerGui then
			playerGui:Destroy()
		end
		print("SpawnController cleaned up for local player.")
	end
end

-- Connect events
Players.PlayerAdded:Connect(SpawnController.onPlayerAdded)
Players.PlayerRemoving:Connect(SpawnController.onPlayerRemoving)

-- Trigger for existing local player
SpawnController.onPlayerAdded(Players.LocalPlayer)

return SpawnController
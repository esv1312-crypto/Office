--!strict
-- ChallengeRemotes.shared.lua
-- Shared setup for RemoteEvents used by the Repeatable Challenge Mechanic.
-- Both server and client require this to agree on remote names.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local ChallengeRemotes = {}

local function getOrCreateRemote(name: string, className: string): RemoteEvent | RemoteFunction
	local existing = ReplicatedStorage:FindFirstChild(name)
	if existing and existing:IsA(className) then
		return existing :: any
	end
	local remote = Instance.new(className)
	remote.Name = name
	remote.Parent = ReplicatedStorage
	return remote :: any
end

-- Fired by client to request starting a challenge.
ChallengeRemotes.StartChallenge = getOrCreateRemote("StartChallenge", "RemoteEvent")
-- Fired by client to request resetting/canceling the current challenge.
ChallengeRemotes.ResetChallenge = getOrCreateRemote("ResetChallenge", "RemoteEvent")
-- Fired by server to notify client of challenge state changes.
ChallengeRemotes.ChallengeStateChanged = getOrCreateRemote("ChallengeStateChanged", "RemoteEvent")
-- Fired by server to notify client of challenge result (success/failure).
ChallengeRemotes.ChallengeResult = getOrCreateRemote("ChallengeResult", "RemoteEvent")

return ChallengeRemotes

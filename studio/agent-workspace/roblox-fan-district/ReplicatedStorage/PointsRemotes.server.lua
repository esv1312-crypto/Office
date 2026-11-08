-- Server-side script to create and configure RemoteEvents/RemoteFunctions
-- This should be placed in ServerScriptService or as a server script

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remoteEvents = Instance.new("Folder")
remoteEvents.Name = "PointsRemotes"
remoteEvents.Parent = ReplicatedStorage

local cheerRemote = Instance.new("RemoteEvent")
cheerRemote.Name = "Cheer"
cheerRemote.Parent = remoteEvents

local collectItemRemote = Instance.new("RemoteEvent")
collectItemRemote.Name = "CollectItem"
collectItemRemote.Parent = remoteEvents

local getPointsRemote = Instance.new("RemoteFunction")
getPointsRemote.Name = "GetPoints"
getPointsRemote.Parent = remoteEvents

print("[PointsRemotes] RemoteEvents created: Cheer, CollectItem, GetPoints")
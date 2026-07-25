-- Zenith AI Connector plugin
-- Install as: AIConnector.plugin.lua in Roblox Studio's Plugins folder.
-- In Studio, enable Game Settings > Security > Allow HTTP Requests.

local SERVER_URL = "https://xzenith.vercel.app"
local HEARTBEAT_INTERVAL = 2
local MAX_HEARTBEAT_FAILURES = 3

local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local toolbar = plugin:CreateToolbar("AI Connector")
local button = toolbar:CreateButton("AIConnector", "Open Zenith AI Connector", "", "AI Connector")

local widgetInfo = DockWidgetPluginGuiInfo.new(
    Enum.InitialDockState.Float,
    false,
    false,
    360,
    320,
    360,
    320
)
local widget = plugin:CreateDockWidgetPluginGui("AIConnectorGui", widgetInfo)
widget.Title = "Zenith AI Connector"

local frame = Instance.new("Frame")
frame.Size = UDim2.fromScale(1, 1)
frame.BackgroundColor3 = Color3.fromRGB(35, 35, 40)
frame.BorderSizePixel = 0
frame.Parent = widget

local title = Instance.new("TextLabel")
title.Size = UDim2.new(1, -24, 0, 36)
title.Position = UDim2.new(0, 12, 0, 10)
title.BackgroundTransparency = 1
title.Text = "Zenith AI Connector"
title.TextColor3 = Color3.fromRGB(255, 255, 255)
title.Font = Enum.Font.GothamBold
title.TextSize = 18
title.Parent = frame

local status = Instance.new("TextLabel")
status.Size = UDim2.new(1, -24, 0, 24)
status.Position = UDim2.new(0, 12, 0, 52)
status.BackgroundTransparency = 1
status.Text = "Disconnected"
status.TextColor3 = Color3.fromRGB(255, 120, 120)
status.Font = Enum.Font.Gotham
status.TextSize = 14
status.TextXAlignment = Enum.TextXAlignment.Left
status.Parent = frame

local connectButton = Instance.new("TextButton")
connectButton.Size = UDim2.new(1, -24, 0, 40)
connectButton.Position = UDim2.new(0, 12, 0, 86)
connectButton.BackgroundColor3 = Color3.fromRGB(65, 65, 72)
connectButton.TextColor3 = Color3.fromRGB(255, 255, 255)
connectButton.Text = "Connect"
connectButton.Font = Enum.Font.GothamSemibold
connectButton.TextSize = 15
connectButton.Parent = frame

local logBox = Instance.new("TextLabel")
logBox.Size = UDim2.new(1, -24, 0, 150)
logBox.Position = UDim2.new(0, 12, 0, 140)
logBox.BackgroundColor3 = Color3.fromRGB(45, 45, 50)
logBox.TextColor3 = Color3.fromRGB(190, 190, 190)
logBox.Font = Enum.Font.Code
logBox.TextSize = 11
logBox.Text = "Log: Ready"
logBox.TextWrapped = true
logBox.TextXAlignment = Enum.TextXAlignment.Left
logBox.TextYAlignment = Enum.TextYAlignment.Top
logBox.Parent = frame

local connected = false
local heartbeatRunning = false
local connecting = false
local sessionId = nil

local function log(message)
    local text = tostring(message)
    logBox.Text = "Log: " .. text
    print("[Zenith AI Connector] " .. text)
end

local function setConnected(value)
    connected = value
    if value then
        status.Text = "Connected"
        status.TextColor3 = Color3.fromRGB(100, 255, 130)
        connectButton.Text = "Disconnect"
        connectButton.BackgroundColor3 = Color3.fromRGB(70, 120, 80)
    else
        status.Text = "Disconnected"
        status.TextColor3 = Color3.fromRGB(255, 120, 120)
        connectButton.Text = "Connect"
        connectButton.BackgroundColor3 = Color3.fromRGB(65, 65, 72)
    end
end

local function normalizePath(path)
    path = tostring(path or "")
    path = path:gsub("^%s+", ""):gsub("%s+$", "")
    return path:gsub("^game%.", "")
end

local function splitPath(path)
    local parts = string.split(normalizePath(path), ".")
    if #parts == 0 or parts[1] == "" then
        return nil
    end
    return parts
end

local function resolveFull(path)
    local parts = splitPath(path)
    if not parts then
        return nil
    end

    local current = game
    for index, part in ipairs(parts) do
        if index == 1 then
            local ok, service = pcall(function()
                return game:GetService(part)
            end)
            current = ok and service or game:FindFirstChild(part)
        else
            current = current and current:FindFirstChild(part)
        end
        if not current then
            return nil
        end
    end
    return current
end

local function resolveParent(path)
    local parts = splitPath(path)
    if not parts or #parts < 2 then
        return nil, nil
    end

    local name = table.remove(parts)
    local current = game
    for index, part in ipairs(parts) do
        if index == 1 then
            local ok, service = pcall(function()
                return game:GetService(part)
            end)
            current = ok and service or game:FindFirstChild(part)
        else
            current = current and current:FindFirstChild(part)
        end
        if not current then
            return nil, nil
        end
    end
    return current, name
end

local function writeSource(target, source)
    if not target or not target:IsA("LuaSourceContainer") then
        return false, "Target is not a LuaSourceContainer"
    end

    local ok, err = pcall(function()
        ScriptEditorService:UpdateSourceAsync(target, function()
            return tostring(source or "")
        end)
    end)
    if not ok then
        return false, tostring(err)
    end
    return true, nil
end

local function executeCommand(command)
    if not command or not command.type then
        return { success = false, error = "Invalid command" }
    end

    local args = command.args or {}
    local commandType = command.type

    if commandType == "ping" then
        log("ping -> pong")
        return { success = true, value = "pong" }
    elseif commandType == "get_tree" then
        local services = {}
        for _, service in ipairs(game:GetChildren()) do
            table.insert(services, service.Name)
        end
        log("get_tree -> " .. tostring(#services) .. " services")
        return { success = true, services = services }
    elseif commandType == "read_script" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        if not target:IsA("LuaSourceContainer") then
            return { success = false, error = "Not a script: " .. path }
        end
        log("read_script: " .. path)
        return { success = true, path = target:GetFullName(), source = target.Source }
    elseif commandType == "create_script" then
        local path = normalizePath(args.path)
        local scriptType = args.type or "Script"
        if scriptType ~= "Script" and scriptType ~= "LocalScript" and scriptType ~= "ModuleScript" then
            return { success = false, error = "Invalid script type: " .. tostring(scriptType) }
        end

        local parent, name = resolveParent(path)
        if not parent then
            return { success = false, error = "Parent not found for path: " .. path }
        end

        local existing = parent:FindFirstChild(name)
        if existing then
            return { success = false, error = "Object already exists: " .. path }
        end

        local newScript = Instance.new(scriptType)
        newScript.Name = name
        newScript.Parent = parent
        local wrote, writeError = writeSource(newScript, args.source or "")
        if not wrote then
            newScript:Destroy()
            return { success = false, error = "Could not write script source: " .. writeError }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith create_script " .. path)
        end)
        log("create_script: " .. path)
        return { success = true, path = newScript:GetFullName(), name = name }
    elseif commandType == "update_script" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        local wrote, writeError = writeSource(target, args.source or "")
        if not wrote then
            return { success = false, error = "Could not write script source: " .. writeError }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith update_script " .. path)
        end)
        log("update_script: " .. path)
        return { success = true, path = target:GetFullName() }
    end

    return { success = false, error = "Unknown command type: " .. tostring(commandType) }
end

local function request(endpoint, body)
    local requestData = {
        Url = SERVER_URL .. endpoint,
        Method = "POST",
        Headers = { ["Content-Type"] = "application/json" },
    }
    if body then
        requestData.Body = HttpService:JSONEncode(body)
    end
    return pcall(function()
        return HttpService:RequestAsync(requestData)
    end)
end

local function sendResult(command, result, executionError)
    local ok, response = request("/command_result", {
        id = command.id,
        result = result,
        error = executionError,
    })
    if not ok or not response.Success then
        log("Could not send result for " .. tostring(command.id))
    end
end

local function startHeartbeat()
    if heartbeatRunning then
        return
    end
    heartbeatRunning = true
    local failures = 0

    task.spawn(function()
        while connected and heartbeatRunning do
            local ok, response = request("/heartbeat", { sessionId = sessionId })
            if not ok or not response.Success then
                failures = failures + 1
                log("Heartbeat failed " .. tostring(failures) .. "/" .. tostring(MAX_HEARTBEAT_FAILURES))
                if failures >= MAX_HEARTBEAT_FAILURES then
                    setConnected(false)
                    heartbeatRunning = false
                    sessionId = nil
                end
            else
                failures = 0
                local decoded, data = pcall(function()
                    return HttpService:JSONDecode(response.Body)
                end)
                if not decoded then
                    log("Invalid heartbeat JSON")
                elseif data.reconnect then
                    log("Session expired; reconnect required")
                    setConnected(false)
                    heartbeatRunning = false
                    sessionId = nil
                else
                    for _, command in ipairs(data.commands or {}) do
                        log("Received " .. tostring(command.type) .. " (" .. tostring(command.id) .. ")")
                        local executed, result = pcall(function()
                            return executeCommand(command)
                        end)
                        if executed then
                            sendResult(command, result, nil)
                        else
                            log("Command failed: " .. tostring(result))
                            sendResult(command, nil, tostring(result))
                        end
                    end
                end
            end
            task.wait(HEARTBEAT_INTERVAL)
        end
    end)
end

local function connect()
    if connected then
        heartbeatRunning = false
        setConnected(false)
        sessionId = nil
        log("Disconnected")
        return
    end
    if connecting then
        return
    end

    connecting = true
    status.Text = "Connecting..."
    local ok, response = request("/connect", {
        placeId = tostring(game.PlaceId),
        username = tostring(game.CreatorId),
    })
    connecting = false

    if not ok or not response.Success then
        setConnected(false)
        log("Connect failed: " .. tostring(response))
        return
    end

    local decoded, data = pcall(function()
        return HttpService:JSONDecode(response.Body)
    end)
    if not decoded or not data.connected or not data.sessionId then
        setConnected(false)
        log("Server returned an invalid connect response")
        return
    end

    sessionId = data.sessionId
    setConnected(true)
    log("Connected, session " .. sessionId)
    startHeartbeat()
end

connectButton.MouseButton1Click:Connect(connect)
button.Click:Connect(function()
    widget.Enabled = not widget.Enabled
end)

log("Plugin loaded - ready to connect")
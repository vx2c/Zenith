-- Zenith AI Connector plugin
-- Install as: AIConnector.plugin.lua in Roblox Studio's Plugins folder.
-- In Studio, enable Game Settings > Security > Allow HTTP Requests.

local SERVER_URL = "https://xzenith.vercel.app"
local HEARTBEAT_INTERVAL = 2
local MAX_HEARTBEAT_FAILURES = 3

local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")
local Selection = game:GetService("Selection")
local LogService = game:GetService("LogService")

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

-- Creation commands accept either:
--   { path = "StarterGui.MainGui" }
-- or the less ambiguous:
--   { parent = "StarterGui", name = "MainGui" }
-- The latter avoids the model accidentally treating a parent as the object path.
local function resolveCreateTarget(args)
    local explicitParent = normalizePath(args and args.parent)
    local explicitName = tostring(args and args.name or ""):gsub("^%s+", ""):gsub("%s+$", "")
    if explicitParent == "" and explicitName ~= "" then
        local parent = resolveFull(args and args.path)
        if not parent then
            return nil, nil, normalizePath(args and args.path), "Parent not found: " .. normalizePath(args and args.path)
        end
        if string.find(explicitName, ".", 1, true) then
            return nil, nil, nil, "name must not contain '.'; use parent for the container path"
        end
        return parent, explicitName, parent:GetFullName() .. "." .. explicitName, nil
    end
    if explicitParent ~= "" or explicitName ~= "" then
        if explicitParent == "" or explicitName == "" then
            return nil, nil, nil, "Both parent and name are required"
        end
        if string.find(explicitName, ".", 1, true) then
            return nil, nil, nil, "name must not contain '.'; use parent for the container path"
        end
        local parent = resolveFull(explicitParent)
        if not parent then
            return nil, nil, nil, "Parent not found: " .. explicitParent
        end
        return parent, explicitName, explicitParent .. "." .. explicitName, nil
    end

    local path = normalizePath(args and args.path)
    local parent, name = resolveParent(path)
    if not parent then
        return nil, nil, path, "Parent not found for path: " .. path
    end
    return parent, name, path, nil
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

-- Convert Roblox values into JSON-safe values for the web app.
local function encodeValue(value)
    local kind = typeof(value)
    if kind == "Color3" then
        return { type = "Color3", r = value.R, g = value.G, b = value.B }
    elseif kind == "Vector2" then
        return { type = "Vector2", x = value.X, y = value.Y }
    elseif kind == "Vector3" then
        return { type = "Vector3", x = value.X, y = value.Y, z = value.Z }
    elseif kind == "UDim" then
        return { type = "UDim", scale = value.Scale, offset = value.Offset }
    elseif kind == "UDim2" then
        return {
            type = "UDim2",
            x = { scale = value.X.Scale, offset = value.X.Offset },
            y = { scale = value.Y.Scale, offset = value.Y.Offset },
        }
    elseif kind == "CFrame" then
        local components = { value:GetComponents() }
        return { type = "CFrame", components = components }
    elseif kind == "BrickColor" then
        return { type = "BrickColor", name = value.Name, number = value.Number }
    elseif kind == "EnumItem" then
        return {
            type = "Enum",
            enum = tostring(value.EnumType):gsub("^Enum%.", ""),
            value = value.Name,
        }
    elseif kind == "Instance" then
        return value:GetFullName()
    elseif type(value) == "table" then
        local result = {}
        for key, item in pairs(value) do
            result[key] = encodeValue(item)
        end
        return result
    end
    return value
end

local function numberOr(value, fallback)
    local number = tonumber(value)
    if number == nil then
        return fallback
    end
    return number
end

local function decodeUDimAxis(axis)
    if type(axis) == "number" or type(axis) == "string" then
        -- Compact AI format: x = 300 means offset 300, scale 0.
        return 0, numberOr(axis, 0)
    end
    if type(axis) ~= "table" then
        return 0, 0
    end
    -- Full format: x = { scale = 0, offset = 300 }.
    -- Also accept common aliases emitted by models.
    local scale = axis.scale
    if scale == nil then scale = axis.Scale end
    local offset = axis.offset
    if offset == nil then offset = axis.Offset end
    return numberOr(scale, 0), numberOr(offset, 0)
end

-- Accept explicit typed JSON values and convert them to Roblox datatypes.
local function decodeValue(value, currentValue)
    if type(value) ~= "table" then
        if typeof(currentValue) == "EnumItem" and type(value) == "string" then
            local enumName = tostring(currentValue.EnumType):gsub("^Enum%.", "")
            local enum = Enum[enumName]
            return enum and enum[value] or value
        end
        return value
    end

    local valueType = value.type
    if valueType == "Color3" then
        return Color3.new(numberOr(value.r, 0), numberOr(value.g, 0), numberOr(value.b, 0))
    elseif valueType == "Vector2" then
        return Vector2.new(numberOr(value.x, 0), numberOr(value.y, 0))
    elseif valueType == "Vector3" then
        return Vector3.new(numberOr(value.x, 0), numberOr(value.y, 0), numberOr(value.z, 0))
    elseif valueType == "UDim" then
        return UDim.new(numberOr(value.scale, 0), numberOr(value.offset, 0))
    elseif valueType == "UDim2" then
        local xScale, xOffset = decodeUDimAxis(value.x or value.X)
        local yScale, yOffset = decodeUDimAxis(value.y or value.Y)
        return UDim2.new(
            xScale, xOffset,
            yScale, yOffset
        )
    elseif valueType == "CFrame" and type(value.components) == "table" then
        return CFrame.new(table.unpack(value.components))
    elseif valueType == "BrickColor" then
        if value.name then
            return BrickColor.new(value.name)
        end
        return BrickColor.new(numberOr(value.number, 1))
    elseif valueType == "Enum" then
        local enumName = tostring(value.enum or ""):gsub("^Enum%.", "")
        local enum = Enum[enumName]
        local item = enum and enum[tostring(value.value)]
        if item then
            return item
        end
    elseif typeof(currentValue) == "EnumItem" and type(value.value) == "string" then
        local enumName = tostring(currentValue.EnumType):gsub("^Enum%.", "")
        local enum = Enum[enumName]
        return enum and enum[value.value] or value
    end
    return value
end

local function applyProperties(target, properties)
    local applied = {}
    local errors = {}
    for property, value in pairs(properties or {}) do
        if property ~= "Parent" then
            local readOk, currentValue = pcall(function()
                return target[property]
            end)
            local converted = decodeValue(value, readOk and currentValue or nil)
            local writeOk, writeError = pcall(function()
                target[property] = converted
            end)
            if writeOk then
                table.insert(applied, property)
            else
                errors[property] = tostring(writeError)
            end
        end
    end
    return next(errors) == nil, applied, errors
end

local PROPERTY_KEYS = {
    "Name", "ClassName", "Archivable", "Parent",
    "Anchored", "CanCollide", "CanTouch", "CanQuery", "CFrame", "Position",
    "Orientation", "Size", "Color", "BrickColor", "Material", "Transparency",
    "CastShadow", "Shape", "Reflectance", "Massless",
    "Text", "TextColor3", "TextSize", "TextScaled", "TextWrapped", "TextXAlignment",
    "TextYAlignment", "Font", "RichText", "LineHeight", "PlaceholderText",
    "BackgroundColor3", "BackgroundTransparency", "BorderColor3", "BorderSizePixel",
    "Visible", "Active", "Selectable", "ZIndex", "LayoutOrder", "Rotation",
    "AnchorPoint", "Position", "Size", "ClipsDescendants", "AutomaticSize",
    "ResetOnSpawn", "IgnoreGuiInset", "DisplayOrder", "Enabled",
    "Image", "ImageColor3", "ImageTransparency", "ScaleType", "SliceCenter",
    "FillDirection", "HorizontalAlignment", "VerticalAlignment", "Padding",
    "SortOrder", "MaxTextSize", "MinTextSize",
}

local function readProperties(target)
    local properties = {}
    for _, property in ipairs(PROPERTY_KEYS) do
        local ok, value = pcall(function()
            return target[property]
        end)
        if ok and typeof(value) ~= "function" then
            properties[property] = encodeValue(value)
        end
    end
    local attributes = {}
    for name, value in pairs(target:GetAttributes()) do
        attributes[name] = encodeValue(value)
    end
    return properties, attributes
end

local function describeInstance(target, includeChildren)
    local item = {
        name = target.Name,
        className = target.ClassName,
        path = target:GetFullName(),
    }
    if includeChildren then
        item.children = {}
        for _, child in ipairs(target:GetChildren()) do
            table.insert(item.children, describeInstance(child, false))
        end
    end
    return item
end

local function buildTree(root, maxDepth, maxNodes)
    local count = 0
    local truncated = false
    local function visit(target, depth)
        if count >= maxNodes then
            truncated = true
            return nil
        end
        count = count + 1
        local node = {
            name = target.Name,
            className = target.ClassName,
            path = target:GetFullName(),
        }
        if depth < maxDepth then
            node.children = {}
            for _, child in ipairs(target:GetChildren()) do
                local childNode = visit(child, depth + 1)
                if childNode then
                    table.insert(node.children, childNode)
                else
                    break
                end
            end
        end
        return node
    end
    local tree = visit(root, 0)
    return tree, count, truncated
end

local function findInstances(root, query, wantedClass, maxResults)
    local results = {}
    local loweredQuery = string.lower(tostring(query or ""))
    local function visit(target)
        if #results >= maxResults then
            return
        end
        local path = target:GetFullName()
        local classMatches = not wantedClass or target:IsA(tostring(wantedClass))
        local textMatches = loweredQuery == ""
            or string.find(string.lower(target.Name), loweredQuery, 1, true)
            or string.find(string.lower(path), loweredQuery, 1, true)
        if classMatches and textMatches then
            table.insert(results, {
                name = target.Name,
                className = target.ClassName,
                path = path,
            })
        end
        for _, child in ipairs(target:GetChildren()) do
            if #results >= maxResults then
                break
            end
            visit(child)
        end
    end
    visit(root)
    return results
end

local function searchScripts(root, query, maxResults)
    local results = {}
    local loweredQuery = string.lower(tostring(query or ""))
    local function visit(target)
        if #results >= maxResults then
            return
        end
        if target:IsA("LuaSourceContainer") then
            local path = target:GetFullName()
            local sourceOk, source = pcall(function()
                return target.Source
            end)
            source = sourceOk and tostring(source or "") or ""
            local haystack = string.lower(target.Name .. "\n" .. path .. "\n" .. source)
            if loweredQuery == "" or string.find(haystack, loweredQuery, 1, true) then
                table.insert(results, {
                    name = target.Name,
                    className = target.ClassName,
                    path = path,
                })
            end
        end
        for _, child in ipairs(target:GetChildren()) do
            if #results >= maxResults then
                break
            end
            visit(child)
        end
    end
    visit(root)
    return results
end

local function formatSource(source)
    local formatted = tostring(source or ""):gsub("\r\n?", "\n")
    formatted = formatted:gsub("[ \t]+\n", "\n")
    formatted = formatted:gsub("[ \t]+$", "")
    return formatted
end

local function detectSystems(root)
    local systems = {}
    local scriptQueries = {
        Leaderstats = "leaderstats",
        DataStores = "datastore",
        RoundSystems = "round",
        CombatSystems = "combat",
        InventorySystems = "inventory",
    }
    for systemName, query in pairs(scriptQueries) do
        local matches = searchScripts(root, query, 20)
        systems[systemName] = {
            detected = #matches > 0,
            matches = matches,
        }
    end
    systems.RemoteEvents = {
        detected = false,
        matches = findInstances(root, "", "RemoteEvent", 50),
    }
    systems.RemoteEvents.detected = #systems.RemoteEvents.matches > 0
    systems.RemoteFunctions = {
        detected = false,
        matches = findInstances(root, "", "RemoteFunction", 50),
    }
    systems.RemoteFunctions.detected = #systems.RemoteFunctions.matches > 0
    systems.GUIs = {
        detected = false,
        matches = findInstances(root, "", "ScreenGui", 50),
    }
    systems.GUIs.detected = #systems.GUIs.matches > 0
    return systems
end

local createChildTree

local function createInstance(parent, name, className, properties, children)
    local ok, instanceOrError = pcall(function()
        return Instance.new(tostring(className))
    end)
    if not ok then
        return nil, "Invalid className: " .. tostring(instanceOrError)
    end
    local instance = instanceOrError
    instance.Name = name
    local propertiesOk, _, propertyErrors = applyProperties(instance, properties)
    if not propertiesOk then
        instance:Destroy()
        return nil, "Could not set properties: " .. HttpService:JSONEncode(propertyErrors)
    end
    instance.Parent = parent
    local created = { instance:GetFullName() }
    for _, childSpec in ipairs(children or {}) do
        local child, childError = createChildTree(instance, childSpec, created)
        if not child then
            instance:Destroy()
            return nil, childError
        end
    end
    return instance, created
end

createChildTree = function(parent, spec, created)
    if type(spec) ~= "table" or not spec.name or not spec.className then
        return nil, "Each child requires name and className"
    end
    local ok, instanceOrError = pcall(function()
        return Instance.new(tostring(spec.className))
    end)
    if not ok then
        return nil, "Invalid className " .. tostring(spec.className) .. ": " .. tostring(instanceOrError)
    end
    local instance = instanceOrError
    instance.Name = tostring(spec.name)
    local propertiesOk, _, propertyErrors = applyProperties(instance, spec.properties)
    if not propertiesOk then
        instance:Destroy()
        return nil, "Could not set child properties: " .. HttpService:JSONEncode(propertyErrors)
    end
    instance.Parent = parent
    table.insert(created, instance:GetFullName())
    for _, childSpec in ipairs(spec.children or {}) do
        local child, childError = createChildTree(instance, childSpec, created)
        if not child then
            return nil, childError
        end
    end
    return instance
end

local function executeCommandRaw(command)
    if not command or not command.type then
        return { success = false, error = "Invalid command" }
    end

    local args = command.args or {}
    local commandType = command.type

    if commandType == "ping" then
        log("ping -> pong")
        return { success = true, value = "pong" }
    elseif commandType == "get_tree" then
        local root = args.path and resolveFull(args.path) or game
        if not root then
            return { success = false, error = "Not found: " .. tostring(args.path) }
        end
        local maxDepth = math.min(math.max(numberOr(args.maxDepth, 6), 0), 12)
        local maxNodes = math.min(math.max(numberOr(args.maxNodes, 500), 1), 2000)
        local tree, count, truncated = buildTree(root, maxDepth, maxNodes)
        log("get_tree: " .. root:GetFullName() .. " (" .. tostring(count) .. " nodes)")
        return {
            success = true,
            root = root:GetFullName(),
            tree = tree,
            count = count,
            truncated = truncated,
        }
    elseif commandType == "find_instances" then
        local root = args.path and resolveFull(args.path) or game
        if not root then
            return { success = false, error = "Not found: " .. tostring(args.path) }
        end
        if args.className then
            local classOk, classError = pcall(function()
                root:IsA(tostring(args.className))
            end)
            if not classOk then
                return { success = false, error = "Invalid className: " .. tostring(classError) }
            end
        end
        local maxResults = math.min(math.max(numberOr(args.maxResults, 100), 1), 500)
        local results = findInstances(root, args.query, args.className, maxResults)
        log("find_instances: " .. tostring(#results) .. " matches")
        return { success = true, results = results, count = #results }
    elseif commandType == "get_selection" then
        local selected = {}
        for _, target in ipairs(Selection:Get()) do
            table.insert(selected, {
                name = target.Name,
                className = target.ClassName,
                path = target:GetFullName(),
            })
        end
        log("get_selection: " .. tostring(#selected) .. " objects")
        return { success = true, selection = selected, count = #selected }
    elseif commandType == "search_scripts" then
        local root = args.path and resolveFull(args.path) or game
        if not root then
            return { success = false, error = "Not found: " .. tostring(args.path) }
        end
        local maxResults = math.min(math.max(numberOr(args.maxResults, 100), 1), 500)
        local results = searchScripts(root, args.query, maxResults)
        log("search_scripts: " .. tostring(#results) .. " matches")
        return { success = true, results = results, count = #results }
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
    elseif commandType == "append_script" or commandType == "format_script" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        if not target:IsA("LuaSourceContainer") then
            return { success = false, error = "Not a script: " .. path }
        end
        local source = target.Source
        if commandType == "append_script" then
            if type(args.source) ~= "string" or args.source == "" then
                return { success = false, error = "source is required for append_script" }
            end
            local separator = ""
            if source ~= "" and source:sub(-1) ~= "\n" then
                separator = "\n"
            end
            source = source .. separator .. args.source
        end
        source = formatSource(source)
        local wrote, writeError = writeSource(target, source)
        if not wrote then
            return { success = false, error = "Could not write script source: " .. writeError }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith " .. commandType .. " " .. path)
        end)
        log(commandType .. ": " .. path)
        return { success = true, path = target:GetFullName(), source = source }
    elseif commandType == "create_module" then
        local parent, name, path, targetError = resolveCreateTarget(args)
        if not parent then
            return { success = false, error = targetError or "Invalid module target" }
        end
        if parent:FindFirstChild(name) then
            return { success = false, error = "Object already exists: " .. path }
        end
        local newScript = Instance.new("ModuleScript")
        newScript.Name = name
        newScript.Parent = parent
        local wrote, writeError = writeSource(newScript, args.source or "return {}")
        if not wrote then
            newScript:Destroy()
            return { success = false, error = "Could not write module source: " .. writeError }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith create_module " .. path)
        end)
        return { success = true, path = newScript:GetFullName(), name = name, className = "ModuleScript" }
    elseif commandType == "get_properties" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        local properties, attributes = readProperties(target)
        log("get_properties: " .. path)
        return {
            success = true,
            path = target:GetFullName(),
            name = target.Name,
            className = target.ClassName,
            properties = properties,
            attributes = attributes,
        }
    elseif commandType == "get_attributes" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        local attributes = {}
        for name, value in pairs(target:GetAttributes()) do
            attributes[name] = encodeValue(value)
        end
        return { success = true, path = target:GetFullName(), attributes = attributes }
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
        if not target:IsA("LuaSourceContainer") then
            return { success = false, error = "Not a script: " .. path }
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
    elseif commandType == "set_properties" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        local ok, applied, errors = applyProperties(target, args.properties)
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith set_properties " .. path)
        end)
        log("set_properties: " .. path)
        return {
            success = ok,
            path = target:GetFullName(),
            applied = applied,
            errors = errors,
            error = ok and nil or "One or more properties could not be set",
        }
    elseif commandType == "set_attributes" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        local applied = {}
        local errors = {}
        for name, value in pairs(args.attributes or {}) do
            local converted = decodeValue(value, nil)
            local ok, err = pcall(function()
                target:SetAttribute(tostring(name), converted)
            end)
            if ok then
                table.insert(applied, tostring(name))
            else
                errors[name] = tostring(err)
            end
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith set_attributes " .. path)
        end)
        return {
            success = next(errors) == nil,
            path = target:GetFullName(),
            applied = applied,
            errors = errors,
        }
    elseif commandType == "create_instance" or commandType == "create_gui" then
        local parent, name, path, targetError = resolveCreateTarget(args)
        if not parent then
            return { success = false, error = targetError or "Invalid creation target" }
        end
        if parent:FindFirstChild(name) then
            return { success = false, error = "Object already exists: " .. path }
        end
        local className = commandType == "create_gui" and "ScreenGui" or args.className
        if not className then
            return { success = false, error = "Missing className" }
        end
        local instance, createdOrError = createInstance(
            parent,
            name,
            className,
            args.properties,
            args.children
        )
        if not instance then
            return { success = false, error = createdOrError }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith " .. commandType .. " " .. path)
        end)
        log(commandType .. ": " .. path .. " (" .. tostring(#createdOrError) .. " instances)")
        return { success = true, path = instance:GetFullName(), className = instance.ClassName, created = createdOrError }
    elseif commandType == "create_ui_element" or commandType == "update_ui_element" then
        if commandType == "update_ui_element" then
            local path = normalizePath(args.path)
            local target = resolveFull(path)
            if not target then
                return { success = false, error = "Not found: " .. path }
            end
            if not target:IsA("GuiObject") and not target:IsA("UIBase") then
                return { success = false, error = "Target is not a UI element: " .. path }
            end
            local ok, applied, errors = applyProperties(target, args.properties)
            if ok then
                pcall(function()
                    ChangeHistoryService:SetWaypoint("Zenith update_ui_element " .. path)
                end)
            end
            return {
                success = ok,
                path = target:GetFullName(),
                applied = applied,
                errors = errors,
                error = ok and nil or "One or more UI properties could not be set",
            }
        end
        local parent = resolveFull(args.parent or args.path)
        local name = tostring(args.name or "")
        if not parent then
            return { success = false, error = "Parent not found: " .. tostring(args.parent or args.path) }
        end
        if name == "" then
            return { success = false, error = "name is required" }
        end
        if parent:FindFirstChild(name) then
            return { success = false, error = "Object already exists: " .. parent:GetFullName() .. "." .. name }
        end
        if not args.className then
            return { success = false, error = "Missing className" }
        end
        local instance, createdOrError = createInstance(parent, name, args.className, args.properties, args.children)
        if not instance then
            return { success = false, error = createdOrError }
        end
        return { success = true, path = instance:GetFullName(), className = instance.ClassName, created = createdOrError }
    elseif commandType == "create_folder"
        or commandType == "create_part"
        or commandType == "create_model"
        or commandType == "create_spawn"
        or commandType == "create_remote_event"
        or commandType == "create_remote_function" then
        local classByCommand = {
            create_folder = "Folder",
            create_part = "Part",
            create_model = "Model",
            create_spawn = "SpawnLocation",
            create_remote_event = "RemoteEvent",
            create_remote_function = "RemoteFunction",
        }
        local parent, name, path, targetError = resolveCreateTarget(args)
        if not parent then
            return { success = false, error = targetError or "Invalid creation target" }
        end
        if parent:FindFirstChild(name) then
            return { success = false, error = "Object already exists: " .. path }
        end
        local instance, createdOrError = createInstance(
            parent,
            name,
            classByCommand[commandType],
            args.properties,
            args.children
        )
        if not instance then
            return { success = false, error = createdOrError }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith " .. commandType .. " " .. path)
        end)
        return { success = true, path = instance:GetFullName(), className = instance.ClassName, created = createdOrError }
    elseif commandType == "rename_instance" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        local name = tostring(args.name or ""):gsub("^%s+", ""):gsub("%s+$", "")
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        if name == "" or string.find(name, ".", 1, true) then
            return { success = false, error = "A simple name without '.' is required" }
        end
        if target.Parent and target.Parent:FindFirstChild(name) then
            return { success = false, error = "Object already exists: " .. target.Parent:GetFullName() .. "." .. name }
        end
        local ok, err = pcall(function()
            target.Name = name
        end)
        if not ok then
            return { success = false, error = tostring(err) }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith rename_instance " .. path)
        end)
        return { success = true, path = target:GetFullName(), name = target.Name }
    elseif commandType == "get_output_logs" then
        local maxResults = math.min(math.max(numberOr(args.maxResults, 100), 1), 500)
        local logs = {}
        local ok, history = pcall(function()
            return LogService:GetLogHistory()
        end)
        if not ok then
            return { success = false, error = "Studio log history unavailable: " .. tostring(history) }
        end
        for index = math.max(1, #history - maxResults + 1), #history do
            local item = history[index]
            table.insert(logs, {
                message = item.message,
                messageType = tostring(item.messageType),
            })
        end
        return { success = true, logs = logs, count = #logs }
    elseif commandType == "clear_output" then
        return { success = false, error = "Roblox Studio does not expose a supported clear-output API to plugins." }
    elseif commandType == "save_place" then
        return { success = false, error = "Saving the place requires Studio UI permission and is not exposed by the supported Plugin API." }
    elseif commandType == "detect_systems" or commandType == "analyze_project" or commandType == "summarize_project" then
        local systems = detectSystems(game)
        if commandType == "detect_systems" then
            return { success = true, systems = systems }
        end
        local tree, count, truncated = buildTree(game, 4, 500)
        local scriptCount = #searchScripts(game, "", 500)
        local summary = {
            placeId = game.PlaceId,
            placeName = game.Name,
            treeNodes = count,
            treeTruncated = truncated,
            scriptCount = scriptCount,
            systems = systems,
        }
        return { success = true, summary = summary, tree = commandType == "analyze_project" and tree or nil }
    elseif commandType == "move_instance" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        local parent = resolveFull(args.parent)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        if not parent then
            return { success = false, error = "Parent not found: " .. tostring(args.parent) }
        end
        if target == game or target.Parent == game then
            return { success = false, error = "Cannot move the DataModel or a top-level service" }
        end
        local ok, err = pcall(function()
            target.Parent = parent
        end)
        if not ok then
            return { success = false, error = tostring(err) }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith move_instance " .. path)
        end)
        return { success = true, path = target:GetFullName(), parent = parent:GetFullName() }
    elseif commandType == "clone_instance" then
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        local parent = resolveFull(args.parent)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        if not parent then
            return { success = false, error = "Parent not found: " .. tostring(args.parent) }
        end
        local cloneOk, clone = pcall(function()
            return target:Clone()
        end)
        if not cloneOk or not clone then
            return { success = false, error = "Could not clone " .. path .. ". The object may not be Archivable." }
        end
        if args.name and tostring(args.name) ~= "" then
            clone.Name = tostring(args.name)
        end
        local parentOk, parentError = pcall(function()
            clone.Parent = parent
        end)
        if not parentOk then
            clone:Destroy()
            return { success = false, error = tostring(parentError) }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith clone_instance " .. path)
        end)
        log("clone_instance: " .. path .. " -> " .. clone:GetFullName())
        return { success = true, source = path, path = clone:GetFullName(), className = clone.ClassName }
    elseif commandType == "delete_instance" then
        if args.confirm ~= true then
            return { success = false, error = "Deletion requires confirm=true after an explicit user request." }
        end
        local path = normalizePath(args.path)
        local target = resolveFull(path)
        if not target then
            return { success = false, error = "Not found: " .. path }
        end
        if target == game or target.Parent == game then
            return { success = false, error = "Cannot delete the DataModel or a top-level service." }
        end
        local fullName = target:GetFullName()
        local ok, err = pcall(function()
            target:Destroy()
        end)
        if not ok then
            return { success = false, error = tostring(err) }
        end
        pcall(function()
            ChangeHistoryService:SetWaypoint("Zenith delete_instance " .. fullName)
        end)
        log("delete_instance: " .. fullName)
        return { success = true, deleted = fullName }
    end

    return { success = false, error = "Unknown command type: " .. tostring(commandType) }
end

-- Keep the wire contract stable for every command, including older commands
-- that historically returned their fields at the top level.
local function executeCommand(command)
    local ok, raw = pcall(function()
        return executeCommandRaw(command)
    end)
    if not ok then
        return { success = false, data = nil, error = tostring(raw) }
    end
    if type(raw) ~= "table" then
        return { success = false, data = nil, error = "Command returned an invalid result" }
    end
    if raw.success == false then
        return { success = false, data = nil, error = tostring(raw.error or "Studio command failed.") }
    end
    local data = {}
    for key, value in pairs(raw) do
        if key ~= "success" and key ~= "error" then
            data[key] = value
        end
    end
    return { success = true, data = data, error = nil }
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

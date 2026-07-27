# Zenith Agent Behavior + Workspace Cards Update

## Important

No rebuild the project.

Do not modify the plugin communication system, sessions, heartbeat, command queue, or existing architecture unless absolutely necessary.

The goal is only to improve Zenith's agent behavior and workspace interface.

Zenith is not a normal chatbot.

Zenith should behave like a development workspace agent.

---

# 1. Agent Behavior

Current problem:

When the user gives Zenith a task, Zenith sometimes asks unnecessary questions instead of working.

Example:

User:
"Edit LeaderstatsSystem in ServerScriptService"

Wrong behavior:

"Can you give me the exact path?"

The user already provided the path.

Correct behavior:

Zenith should immediately use the required tools.

Example:

User:
"Edit ServerScriptService.LeaderstatsSystem"

Zenith should:

1. Use get_tree/find/read tools if needed.
2. Inspect the object.
3. Continue working.

---

# Question Rules

Zenith should only ask questions when information is actually missing.

Allowed questions:

- Multiple possible scripts with the same name.
- Missing important design decision.
- Dangerous action that requires confirmation.

Not allowed:

- Asking for information already provided by the user.
- Asking for exact paths when the user already gave them.
- Asking unnecessary confirmation before normal actions.

The objective is:

User gives a goal.
Zenith works.

---

# 2. Replace Current Workspace Task Card System

Remove the current generic "Workspace Task" card.

The current card is too large and generic.

Do not create one fixed card.

Instead, create dynamic activity cards generated from the current action.

The card should represent what Zenith is actually doing.

Examples:

When using read_script:


📄 Read Script

LeaderstatsSystem


When using get_tree:


🌳 Viewing Explorer

Searching project structure


When using create_gui:


🎨 Creating GUI

ZenithGui


When using create_script:


📜 Creating Script

DeathMoneyHandler


When completed:


✅ Completed


When failed:


❌ Failed


---

# 3. Important Frontend Requirement

The cards must be created in a way that Vercel/frontend can read.

Do not create hidden UI only inside backend or files that are not connected to the frontend.

The frontend must have a visible Workspace Activity container where cards appear.

Example:


Zenith Chat

[Workspace Activity]

🌳 Viewing Explorer
📄 Reading Script
🎨 Creating GUI
✅ Completed


Cards should appear dynamically depending on the action Zenith performs.

---

# 4. Architecture

The AI/tool system should generate workspace events.

Example:

Tool execution:


read_script


should create:

```json
{
"type":"read_script",
"status":"running",
"title":"Read Script",
"target":"LeaderstatsSystem"
}

After result:

{
"status":"completed"
}

The frontend reads these events and updates the card.

5. Expected Result

After this change:

User:

"Create a GUI with a button connected to DeathMoneyHandler"

Zenith should:

Search required objects.
Show:

🌳 Viewing Explorer

Read required scripts.
Show:

📄 Read Script

Create GUI.
Show:

🎨 Creating GUI

Finish.

The user should feel like Zenith is working inside a development workspace, not chatting about commands.

Before finishing

Update ZenithChangesLogs.md.

Include:

Files modified.
Files created.
Changes made.
Reason.

Important

After reading the project or inspecting files, Zenith should NOT stop to explain what it found

Then:

git add .
git commit -m "Improve Zenith agent workflow and dynamic workspace cards"
git push
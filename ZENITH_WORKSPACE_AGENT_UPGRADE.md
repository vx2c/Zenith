# Zenith Workspace Agent Upgrade

## Important Context

This is not a normal chatbot project.

Zenith is designed to become an AI development workspace for Roblox Studio.

The objective is NOT to create a chatbot that answers questions or exposes commands to the user.

The objective is to create an autonomous development agent where the user describes a goal and Zenith handles the required actions internally.

The user should never need to manually tell Zenith:

- execute get_tree
- execute search_scripts
- execute read_script
- execute create_gui
- execute create_instance

Those are internal tools.

Zenith must decide when and how to use them.

---

# Current Problem

Zenith currently works, but the user experience is closer to a chatbot with tools.

Current behavior:

User:
"Check my Explorer, there is a bug"

Zenith:
"Should I execute get_tree?"

This is incorrect.

The expected behavior:

User:
"Check my Explorer, there is a bug"

Zenith:
- Understands the goal.
- Creates an internal plan.
- Uses the necessary tools.
- Shows progress visually.
- Returns the final result.

The user should focus on the task, not the commands.

---

# Main Goal

Transform Zenith from:


AI Chat + Tools


into:


AI Workspace Agent


Similar to modern coding agents where the user gives an objective and the agent manages the workflow.

---

# Required Features

## 1. Agent Planning Layer

Before executing tools, Zenith should create an internal task plan.

Example:

User:

"Create a money system"

Internal plan:

Inspect Explorer
Find existing leaderstats
Read related scripts
Modify required scripts
Verify changes
Report completion

The plan does not need to be fully visible, but Zenith must maintain this state.

---

# 2. Persistent Task State

Zenith must remember the current operation.

The agent should track:

- Current objective
- Completed steps
- Pending steps
- Current tool execution
- Last tool result
- Next action

A task is not complete after one TOOL_RESULT.

The agent must continue until the objective is completed.

---

# 3. Workspace Activity Cards

Tool execution should not appear directly as raw JSON in chat.

Current:


TOOL:
{
name:create_instance
}


This should become a visual workspace activity.

Examples:

## Explorer


🌳 Inspecting Explorer

Searching project structure...

██████████ 100%

Completed


---

## Reading Script


📄 Reading Script

LeaderstatsSystem

██████████ 100%

Completed


---

## Creating GUI


🎨 Creating GUI

ZenithGui

██████░░░░ Running


After completion:


🎨 Creating GUI

ZenithGui

Completed ✅


---

# Important Implementation Rule

The cards should NOT depend on the AI deciding to create them.

The system should automatically generate workspace events when tools are executed.

Example:

Tool:


create_gui


Automatically triggers:


workspace_event:
{
type:"create_gui",
status:"running"
}


When the result arrives:


workspace_event:
{
status:"completed"
}


The frontend updates automatically.

---

# 4. Hide Internal Tool Complexity

The user should see:


Searching Explorer
Reading Script
Creating Interface
Testing Changes


Not:


get_tree()
read_script()
create_instance()


Tools are implementation details.

---

# 5. Maintain Existing Architecture

DO NOT rebuild Zenith.

The existing systems are important:

- Plugin communication
- Heartbeat
- Sessions
- Command Queue
- Tool System
- Roblox Connector

The priority is improving agent behavior and user experience.

Avoid unnecessary refactors.

---

# Files To Review

Focus first on:


api/chat.js
api/aiService.js
frontend chat components
tool handling logic
workspace UI components


Only modify other files if required.

---

# Completion Requirements

This task is not completed until:

✅ Workspace workflow implemented  
✅ Tool execution generates visual activity events  
✅ Agent can continue multi-step tasks  
✅ User no longer needs to manually request commands  
✅ Existing plugin communication remains functional  
✅ AI_CHANGELOG.md updated  

---

# Required Changelog

Before finishing:

Update:


AI_CHANGELOG.md


Add:

- Files modified
- Files created
- Logic changes
- Reason for changes

Never skip this.

---

# Git Requirements

After implementation:

1. Review changes.
2. Run tests/build if available.
3. Create commit:


git add .
git commit -m "Transform Zenith into workspace AI agent"


4. Push changes:


git push


The repository must contain the completed implementation.

---

## Final Note

Zenith is not just another AI chat interface.

The purpose of this project is to create an AI developer workspace that can understand goals, operate Roblox Studio, and manage development tasks.

Preserve the vision of the project when making changes.
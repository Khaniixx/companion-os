---
name: app-launcher
version: 0.1.0
description: >
  Launches common desktop applications on behalf of the user.  The skill
  exposes a simple interface for opening applications like Spotify,
  Discord or the default web browser.  It requests permission before
  launching a new process.
permissions:
  - open_app
---

## Usage

This skill enables the companion to open applications by name.  A typical
instruction might be:

```
"Open Spotify"
```

Upon receiving such a command, the agent runtime will invoke the `open_app`
tool with the provided application name.  If the user has not previously
granted the `open_app` permission, the companion will prompt for approval.

## Permissions

`open_app`: allows the skill to request launching a desktop application by
name.  The user must explicitly grant this permission.

## Implementation

Implementation code lives in `handlers/` and registers the skill with the
agent runtime.  It defines a Python function that accepts the application
name as input, performs any validation, and uses OS‑specific mechanisms to
launch the process.
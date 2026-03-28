---
name: browser-helper
version: 0.1.0
description: >
  Provides basic browser interactions such as opening URLs and performing
  simple searches.  This skill allows the companion to navigate to a
  website or execute a search query on behalf of the user, offering
  progress feedback and maintaining privacy by using the system's default
  browser.
permissions:
  - open_url
---

## Usage

The browser helper skill enables commands like:

```
"Search for new game trailers"
"Open the OpenAI website"
```

The agent runtime routes these requests to the `open_url` tool, either
building a search URL or opening the specified site.  The companion will
prompt the user if permission to open a URL has not been granted.

## Permissions

`open_url`: allows the skill to launch the default web browser to a
specified URL.

## Implementation

The implementation resides in `handlers/` and uses the OS to construct
a `https://` URL from a search query or accept a full URL.  It then
invokes the runtime's browser tool and returns control back to the
companion for appropriate feedback.
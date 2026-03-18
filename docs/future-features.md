# Future Features Roadmap

This document outlines planned post-v1 features for HappyTrails. These features are intended for development after the initial release and provide guidance for future implementers.

## 1. Search

Full-text search across all captured output with an intuitive interface for reviewing logged activity.

- **Full-text search** across all captured tool output
- **Highlight matches** in the current view mode to easily spot search results
- **Search-as-you-type** functionality with debounce to prevent excessive filtering

## 2. Filtering

Enable selective viewing of logged activity based on various criteria.

- **Filter by tool type** using checkboxes (Bash, Read, Write, Edit, Grep, Glob, WebFetch, WebSearch, etc.)
- **Filter by status** (success/failure)
- **Combine filters** with search for powerful, multi-dimensional log exploration

## 3. Export

Support multiple export formats to enable integration with other tools and workflows.

- **Export full log as JSONL** (raw data format for programmatic access)
- **Export rendered view as HTML** for sharing and archiving
- **Export rendered view as plain text** for simpler consumption

## 4. Selective Export

Allow users to cherry-pick specific log entries rather than exporting everything.

- Select individual or multiple entries from the log
- Export only the selected entries in any of the supported formats (JSONL, HTML, plain text)

## 5. File Streaming

Configure HappyTrails to stream log entries to a persistent output file in addition to the browser interface.

- Configure an output file path via settings or CLI flag
- HappyTrails streams log entries to that file in addition to the browser pane
- Useful for piping into other tools or archiving logs for post-hoc review
- Enables offline workflows where logs can be reviewed even if the browser pane is closed

## 6. Persistent Hooks

Extend the hooks system to remain active even when the HappyTrails server isn't running.

- **Current behavior:** Hooks are ephemeral, installed when the server starts and removed when it stops
- **Proposed enhancement:** Option to keep hooks always active even when server isn't running
- **Benefits:** Enable offline log collection for post-hoc review, useful for long-running or background processes
- **Note:** This is a documented decision point for future consideration. Implementation would require careful consideration of hook lifecycle management and cleanup.

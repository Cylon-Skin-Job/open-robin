# AI Panel Structure

This directory contains AI agent panel state and conversation history for the Explorer.

## Directory Structure

```
ai/
└── panels/
    └── explorer/
        ├── sessions/           # Active and suspended session state
        │   ├── active/         # Currently running wire sessions
        │   ├── grace-period/   # Disconnected but process alive (60s window)
        │   └── suspended/      # Process killed, history preserved
        ├── threads/            # Thread metadata and conversation history
        │   ├── {thread-id}.json
        │   └── {thread-id}.summary
        └── checkpoints/        # Periodic conversation snapshots
            └── {thread-id}/
                └── {timestamp}.json
```

## Lifecycle States

### Active
- Wire process running and connected
- Real-time streaming
- Full resource allocation

### Grace Period
- WebSocket disconnected
- Process alive, paused
- 60-second reconnection window
- Visual indicator: 🟡

### Suspended
- Process killed
- Full conversation history saved to disk
- Restored via agent warm-up on reactivation
- Visual indicator: ⚪

### Archived
- Compressed/summarized history
- Minimal storage footprint
- Can be fully restored or viewed as summary

## Session Management

- **Max Active Sessions**: 5 (configurable)
- **Grace Period Duration**: 60 seconds
- **Eviction Policy**: LRU (Least Recently Used)
- **Thread History**: Preserved indefinitely unless manually deleted

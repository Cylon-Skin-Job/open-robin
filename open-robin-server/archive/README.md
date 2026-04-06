# Archive

This folder contains dead code from the original vanilla JavaScript client.

It is NOT served by the server anymore. The server now serves the React client from `kimi-ide-client/dist/`.

Preserved here in case you need to reference the original implementation.

## Files:

- `legacy-vanilla-client.html` - Original single-file HTML/JS client (the "old way")

## What was removed:

- `public/` folder - No longer served (server now uses `kimi-ide-client/dist/`)

## If you need the pulsating thing:

See `kimi-ide-client/src/components/PulseSymbol.tsx` - that's the current implementation.

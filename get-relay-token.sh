#!/bin/bash
# Helper script to read the relay auth token
# Works on Unix/Linux/macOS

# Determine config directory (respects XDG on Linux, uses ~/.config otherwise)
if [ -n "$XDG_CONFIG_HOME" ]; then
    CONFIG_DIR="$XDG_CONFIG_HOME/opencode-relay"
elif [ -n "$HOME" ]; then
    CONFIG_DIR="$HOME/.config/opencode-relay"
else
    echo "Error: Could not determine config directory" >&2
    exit 1
fi

TOKEN_FILE="$CONFIG_DIR/auth-token"

if [ -f "$TOKEN_FILE" ]; then
    cat "$TOKEN_FILE"
else
    echo "Error: Auth token not found at $TOKEN_FILE" >&2
    echo "Please run the relay broker at least once to generate a token." >&2
    echo "" >&2
    echo "On Windows, token location is:" >&2
    echo "  %APPDATA%\\opencode-relay\\auth-token" >&2
    echo "Use get-relay-token.ps1 on Windows." >&2
    exit 1
fi

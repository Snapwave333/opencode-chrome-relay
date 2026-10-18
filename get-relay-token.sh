#!/bin/bash
# Helper script to read the relay auth token
# Used by native host and other components

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode-relay"
TOKEN_FILE="$CONFIG_DIR/auth-token"

if [ -f "$TOKEN_FILE" ]; then
    cat "$TOKEN_FILE"
else
    echo "Error: Auth token not found at $TOKEN_FILE" >&2
    echo "Please run the relay broker at least once to generate a token." >&2
    exit 1
fi

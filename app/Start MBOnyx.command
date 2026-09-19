#!/bin/bash
#  Double-click this file to open the MBOnyx lead checker.
#  Everything it does lives in start.mjs; this only finds Node and runs it.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  # A double-clicked .command does not inherit a login shell's PATH, so Node
  # installed by Homebrew or nvm is invisible here even though it works in a
  # terminal. Look in the usual places before giving up on it.
  for dir in /usr/local/bin /opt/homebrew/bin "$HOME/.nvm/versions/node"/*/bin; do
    [ -x "$dir/node" ] && PATH="$dir:$PATH" && break
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  This Mac does not have Node installed yet."
  echo
  echo "  1. Go to  https://nodejs.org"
  echo "  2. Download the big green \"LTS\" button and install it."
  echo "  3. Double-click this file again."
  echo
  read -r -p "  Press return to close. "
  exit 1
fi

node start.mjs

#  A crash would otherwise close the window before the message could be read.
status=$?
if [ "$status" -ne 0 ]; then
  echo
  read -r -p "  Press return to close. "
fi
exit "$status"

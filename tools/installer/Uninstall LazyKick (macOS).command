#!/bin/bash
# LazyKick - removes the panel. Your notes, watch bins and settings are
# removed too, but only if you say so. Pasted images stay next to your projects.
set -u

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.sohan.LazyKick"
DATA="$HOME/Library/Application Support/AdobeProjectNotepad"

echo "Removing the LazyKick panel..."
read -r -p "Close After Effects and Premiere Pro, then press return. " _

if [ -e "${DEST}" ]; then
  rm -rf "${DEST}" && echo "Removed the panel."
else
  echo "The panel was not installed."
fi

if [ -d "${DATA}" ]; then
  echo
  echo "LazyKick keeps your project notes, watch bins and settings in"
  echo "  ${DATA}"
  read -r -p "Delete your notes and settings as well? [y/N] " answer
  case "${answer}" in
    [yY]*) rm -rf "${DATA}" && echo "Removed your notes and settings." ;;
    *) echo "Kept them." ;;
  esac
fi

echo
echo "Pasted images stay in the \"Pasted Images\" folders next to your projects."
read -r -p "Press return to close. " _

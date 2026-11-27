#!/bin/bash
fetch() { curl -fsSL -o "$2" -- "$1"; }
fetch "http://127.0.0.1:$PORT/x.json" "$TMP/out"

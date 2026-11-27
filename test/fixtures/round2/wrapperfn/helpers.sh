#!/bin/bash
# A wrapper around the real tool is still a download.
curl() { command curl --retry 3 "$@"; }

#!/usr/bin/env sh
# Point git at the repo's hooks so formatting is fixed before each commit.
git config core.hooksPath .husky && echo "Git hooks installed from .husky/"

#!/bin/bash

cd core
npm version patch
cd ..

cd cli
npm version patch
cd ..

git add ./**/package.json ./**/package-lock.json

version=$(node -p "require('./core/package.json').version")
git commit -m "v$version"


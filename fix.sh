#!/bin/sh

# Update package lists
sudo apt-get update

# Install fontconfig and common fonts
sudo apt-get install -y fontconfig fonts-dejavu-core fonts-liberation fonts-freefont-ttf

# Install libvips (required for sharp)
sudo apt-get install -y libvips libvips-dev

# (Optional) Rebuild sharp in case native modules need to be rebuilt after installing system libs
npm rebuild sharp

# (Optional) Print font list for debugging
fc-list

echo "System dependencies for Sharp and SVG font rendering installed."
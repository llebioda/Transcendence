#!/bin/bash

# Define colors
RESET='\033[0m'
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
PURPLE='\033[0;37m'

# TypeScript compilation
echo -e "${BLUE}Starting TypeScript compilation...${RESET}"
tsc
if [ $? -ne 0 ]; then
  echo -e "${RED}TypeScript compilation failed. Exiting...${RESET}"
  exit 1
fi

# TailwindCSS compilation
echo -e "${BLUE}Building CSS with TailwindCSS...${RESET}"
tailwindcss -i ./public/style.css -o ./public/output.css --minify
if [ $? -ne 0 ]; then
  echo -e "${RED}CSS build failed. Exiting...${RESET}"
  exit 1
fi

# Webpack bundling
echo -e "${PURPLE}Running Webpack in development mode...${RESET}"
webpack --mode development
if [ $? -ne 0 ]; then
  echo -e "${RED}Webpack build failed. Exiting...${RESET}"
  exit 1
fi

echo -e "\n${GREEN}Development build completed successfully!${RESET}\n"

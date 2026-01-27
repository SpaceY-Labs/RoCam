#!/usr/bin/env sh

# Navigate to the same directory as this script
cd "$(dirname "$0")"

# Remove power limit
sudo nvpmodel -m 2

# Set clock speed to max
sudo jetson_clocks

# Load DRM module
sudo modprobe nvidia-drm modeset=1

# Set permissions for serial port
sudo chmod 777 /dev/ttyTHS1

# Allow python to bind to ports and set priority
sudo setcap 'cap_net_bind_service,cap_sys_nice=+eip' /usr/bin/python3.10

# Start backend
python3 src/main.py

import os
import sys

if len(sys.argv) < 2:
    print("Please provide the port as an argument")
    print("Example: python flash.py /dev/tty.usbmodem101")
    sys.exit(1)

port = sys.argv[1]

os.system(f"esptool.py --chip esp32c3 --port {port} erase_flash")
os.system(f"esptool.py --chip esp32c3 --port {port} --baud 460800 write_flash -z 0x0 ESP32_GENERIC_C3-20240602-v1.23.0.bin")


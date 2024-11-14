# boot.py
import network
import time
import credentials

def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    print('[BOOT] Activating WiFi interface...')
    if not wlan.isconnected():
        print('[BOOT] Connecting to Wi-Fi network:', credentials.WIFI_SSID)
        wlan.connect(credentials.WIFI_SSID, credentials.WIFI_PASSWORD)
        attempt = 1
        while not wlan.isconnected():
            print('[BOOT] Connection attempt {}...'.format(attempt))
            time.sleep(1)
            attempt += 1
    print('[BOOT] WiFi Connected! Network config:', wlan.ifconfig())
    return wlan

# Connect to Wi-Fi on boot
print('[BOOT] Starting boot sequence...')
wlan = connect_wifi()

# Run main.py after setup
try:
    print('[BOOT] WiFi connected, checking main.py...')
    with open('main.py', 'r') as f:
        print('[BOOT] Main.py file found')
    
    print('[BOOT] Importing main module...')
    import main
    print('[BOOT] Main module imported, starting run()...')
    main.run()
except Exception as e:
    print("[BOOT] Error details:", str(e))
    import sys
    sys.print_exception(e)  # This will print the full traceback

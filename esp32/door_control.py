# door_control.py
from machine import Pin
import neopixel
import time

# Hardware setup
relay = Pin(1, Pin.OUT)
relay.value(0)  # Start with door closed
button = Pin(9, Pin.IN, Pin.PULL_UP)
np = neopixel.NeoPixel(Pin(2), 1)

# Global state
last_press = 0
door_timer = 0

# Door timeout configuration
DOOR_OPEN_DURATION = 3000  # 3 seconds door open timeout

def set_led(r, g, b):
    np[0] = (r, g, b)
    np.write()

def set_wifi_status_led(is_connected):
    """
    Set LED color based on WiFi connection status
    Blue: Disconnected or connecting
    Green: Door Open
    Red: Door Closed
    """
    if not is_connected:
        # Pulsing blue when WiFi is disconnected
        for brightness in range(0, 256, 5):
            set_led(0, 0, min(brightness, 255))
            time.sleep(0.01)
        for brightness in range(255, -1, -5):
            set_led(0, 0, max(brightness, 0))
            time.sleep(0.01)
    elif relay.value() == 1:
        set_led(0, 255, 0)  # Green for open door
    else:
        set_led(255, 0, 0)  # Red for closed door

def get_door_state():
    return relay.value()

def open_door():
    global door_timer
    print("[DOOR] Opening door...")
    relay.value(1)  # Open door
    set_led(0, 255, 0)  # Green LED
    door_timer = time.ticks_ms()  # Start door timer
    print(f"[DOOR] Timer started at {door_timer}, will close after {DOOR_OPEN_DURATION}ms")

def close_door():
    global door_timer
    print("[DOOR] Closing door...")
    relay.value(0)  # Close door
    set_led(255, 0, 0)  # Red LED
    door_timer = 0

def handle_button(pin):
    global last_press
    now = time.ticks_ms()
    if time.ticks_diff(now, last_press) > 300:  # Debounce
        last_press = now
        if relay.value() == 0:  # If door is closed
            open_door()
        else:
            close_door()

def check_door_timeout():
    global door_timer
    if door_timer > 0:
        current_time = time.ticks_ms()
        time_diff = time.ticks_diff(current_time, door_timer)
        if time_diff >= DOOR_OPEN_DURATION:
            print(f"[DOOR] Door timeout reached. Time open: {time_diff}ms")
            close_door()
        elif time_diff % 1000 == 0:  # Log every second
            print(f"[DOOR] Door has been open for {time_diff}ms")

def flash_error():
    for _ in range(3):
        set_led(255, 0, 0)
        time.sleep(0.2)
        set_led(0, 0, 0)
        time.sleep(0.2)
    set_led(255, 0, 0) if relay.value() == 0 else set_led(0, 255, 0)

def initialize():
    print("[DOOR] Initializing door control...")
    close_door()  # Ensure door starts closed
    button.irq(trigger=Pin.IRQ_FALLING, handler=handle_button)  # Setup button interrupt
    print("[DOOR] Door initialized to closed state")

# main.py
import time
import sys
import machine
import door_control
import wifi_manager
import url_client
from time import sleep

# Initialize watchdog with 30 second timeout
watchdog = machine.WDT(timeout=30000)  # 30 seconds

MAX_WIFI_RETRIES = 5
wifi_retry_count = 0

class SystemManager:
    def __init__(self, reboot_interval=24 * 60 * 60):  # Default 24 hours
        self.reboot_interval = reboot_interval
        self.last_check_time = time.time()
        self.wifi_reconnect_attempts = 0
        self.max_reconnect_attempts = 5

    def check_system_health(self):
        """Perform system health checks and take corrective actions"""
        current_time = time.time()
        
        # Check WiFi connection
        if not wifi_manager.wifi_manager.check_connection():
            self.wifi_reconnect_attempts += 1
            print(f'[SYSTEM] WiFi connection lost. Attempt {self.wifi_reconnect_attempts}')
            
            # Close door as a safety measure
            door_control.close_door()
            
            # Attempt to reconnect
            if not wifi_manager.wifi_manager.connect():
                print('[SYSTEM] WiFi reconnection failed.')
                
                if self.wifi_reconnect_attempts >= self.max_reconnect_attempts:
                    self.trigger_reboot("Network Stability")
        else:
            self.wifi_reconnect_attempts = 0
        
        # Check for reboot based on uptime
        if current_time - self.last_check_time >= self.reboot_interval:
            self.trigger_reboot("Periodic System Maintenance")
        
        self.last_check_time = current_time

    def trigger_reboot(self, reason="Unknown"):
        """Safely trigger system reboot"""
        print(f'[REBOOT] Triggered - Reason: {reason}')
        door_control.close_door()  # Ensure door is closed
        time.sleep(2)  # Short delay
        machine.reset()  # Use machine.reset() for more reliable reset

def run():
    print('[MAIN] Starting...')
    
    # Initialize System Manager
    system_manager = SystemManager()
    
    try:
        # Always start with door closed
        door_control.close_door()
        
        # Initialize WiFi connection
        wifi_manager.wifi_manager.connect()
        
        # Start URL client background checks
        url_client.url_client.start_background_check()
        
        # Initialize door control (sets up button interrupt)
        door_control.initialize()
        
        print('[MAIN] Setup complete, entering main loop...')
        
        last_health_check = time.ticks_ms()
        HEALTH_CHECK_INTERVAL = 30000  # 30 seconds in milliseconds
        
        while True:
            try:
                # Feed the watchdog to prevent reset
                watchdog.feed()
                
                # Check door timeout more frequently
                door_control.check_door_timeout()
                
                current_time = time.ticks_ms()
                
                # Only do system health check every 30 seconds
                if time.ticks_diff(current_time, last_health_check) >= HEALTH_CHECK_INTERVAL:
                    system_manager.check_system_health()
                    last_health_check = current_time
                
                # Short sleep to prevent CPU overload but allow quick door timeout checks
                time.sleep(0.1)  # 100ms sleep
            
            except Exception as e:
                print(f'[MAIN] Error in main loop: {e}')
                # Ensure door is closed during any error
                door_control.close_door()
                time.sleep(5)  # Longer delay to prevent rapid error cycling
    
    except Exception as critical_error:
        print(f'[MAIN] Critical system error: {critical_error}')
        # Ensure door is closed during critical failure
        door_control.close_door()
        time.sleep(5)  # Wait a moment
        system_manager.trigger_reboot("Critical Error")

if __name__ == '__main__':
    run()

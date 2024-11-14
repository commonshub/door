import network
import time
import credentials
import door_control

class WiFiManager:
    def __init__(self, ssid=credentials.WIFI_SSID, password=credentials.WIFI_PASSWORD):
        self.ssid = ssid
        self.password = password
        self.wlan = network.WLAN(network.STA_IF)
        self.wlan.active(True)
        self.connection_attempts = 0
        self.max_connection_attempts = 10
        self.base_reconnect_delay = 1  # Base delay in seconds
        self.max_reconnect_delay = 60  # Maximum delay between attempts
        self.status_callback = None

    def connect(self):
        """Attempt to connect to WiFi with exponential backoff"""
        # Signal WiFi connection attempt with blue LED
        door_control.set_wifi_status_led(False)
        
        if not self.wlan.isconnected():
            print(f'[WiFi] Connecting to {self.ssid}...')
            self.wlan.connect(self.ssid, self.password)
            
            # Wait for connection with progressive timeout
            for attempt in range(50):  # 5 second initial timeout
                if self.wlan.isconnected():
                    self._on_connect()
                    return True
                
                # Check signal strength and adjust strategy
                rssi = self.get_rssi()
                print(f'[WiFi] Connection attempt {attempt+1}, Signal: {rssi} dBm')
                
                time.sleep(0.1)
            
            # Connection failed
            return self._handle_connection_failure()
        return True

    def get_rssi(self):
        """Get WiFi signal strength"""
        try:
            return self.wlan.status('rssi')
        except Exception:
            return -100  # Worst case signal strength

    def _on_connect(self):
        """Handle successful connection"""
        self.connection_attempts = 0
        print(f'[WiFi] Connected to {self.ssid}')
        print(f'[WiFi] Network config: {self.wlan.ifconfig()}')
        print(f'[WiFi] Signal strength: {self.get_rssi()} dBm')
        
        # Set LED to door state after successful connection
        door_control.set_wifi_status_led(True)
        
        if self.status_callback:
            self.status_callback(True)

    def _handle_connection_failure(self):
        """Handle connection failures with exponential backoff"""
        self.connection_attempts += 1
        
        # Calculate exponential backoff delay
        delay = min(
            self.base_reconnect_delay * (2 ** self.connection_attempts), 
            self.max_reconnect_delay
        )
        
        print(f'[WiFi] Connection failed. Attempt {self.connection_attempts}')
        print(f'[WiFi] Waiting {delay} seconds before retry')
        
        # Ensure blue LED continues to pulse during connection attempts
        door_control.set_wifi_status_led(False)
        
        if self.connection_attempts >= self.max_connection_attempts:
            print('[WiFi] Max connection attempts reached. Performing full network reset...')
            self.wlan.disconnect()
            self.wlan.active(False)
            time.sleep(2)
            self.wlan.active(True)
            self.connection_attempts = 0
        
        time.sleep(delay)
        
        if self.status_callback:
            self.status_callback(False)
        
        return False

    def check_connection(self):
        """Advanced connection checking with diagnostics"""
        if not self.wlan.isconnected():
            print('[WiFi] Connection lost. Detailed diagnostics:')
            print(f'[WiFi] SSID: {self.ssid}')
            print(f'[WiFi] Current Status: {self.wlan.status()}')
            print(f'[WiFi] Signal Strength: {self.get_rssi()} dBm')
            
            # Pulse blue LED during connection loss
            door_control.set_wifi_status_led(False)
            
            return self.connect()
        
        # Periodic signal strength logging
        rssi = self.get_rssi()
        if rssi < -80:
            print(f'[WiFi] Warning: Low signal strength {rssi} dBm')
        
        return True

    def set_status_callback(self, callback):
        """Set a callback for connection status changes"""
        self.status_callback = callback

def auto_reconnect(wifi_manager, check_interval=10):
    """Background task to periodically check and maintain WiFi connection"""
    while True:
        try:
            wifi_manager.check_connection()
            time.sleep(check_interval)
        except Exception as e:
            print(f'[WiFi] Critical error in auto-reconnect: {e}')
            time.sleep(check_interval)

# Create a global WiFi manager instance
wifi_manager = WiFiManager()

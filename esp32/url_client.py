import urequests
import time
import _thread
import door_control

class URLClient:
    def __init__(self, server_url="https://door.commonshub.brussels/check", 
                 check_interval=3, 
                 timeout=5):
        """
        Initialize URLClient for periodic server status checks
        
        :param server_url: URL to check for door opening status
        :param check_interval: Time between server checks in seconds
        :param timeout: Request timeout in seconds
        """
        self.server_url = server_url
        self.check_interval = check_interval
        self.timeout = timeout
        self.running = False

    def check_server_status(self):
        """
        Check server status and potentially open door
        
        :return: True if server returned 200, False otherwise
        """
        try:
            print(f'[URLClient] Checking server status: {self.server_url}')
            response = urequests.get(self.server_url, timeout=self.timeout, headers={'User-Agent': 'CHB Door (ESP32-C3)'})
            
            if response.status_code == 200:
                print('[URLClient] Server check successful. Opening door.')
                door_control.open_door()
                response.close()
                return True
            
            response.close()
            return False
        
        except Exception as e:
            print(f'[URLClient] Server check error: {e}')
            return False

    def start_background_check(self):
        """
        Start background thread for periodic server checks
        """
        if not self.running:
            self.running = True
            _thread.start_new_thread(self._background_check, ())
            print('[URLClient] Background server check started')

    def stop_background_check(self):
        """
        Stop background server checks
        """
        self.running = False
        print('[URLClient] Background server check stopped')

    def _background_check(self):
        """
        Internal method for continuous server checking
        """
        while self.running:
            try:
                self.check_server_status()
                time.sleep(self.check_interval)
            except Exception as e:
                print(f'[URLClient] Background check error: {e}')
                time.sleep(self.check_interval)

    def check_server(self):
        try:
            print(f'[URLClient] Checking server status: {self.check_url}')
            response = urequests.get(self.check_url, timeout=5)
            response.close()
            return True
        except OSError as e:
            if e.errno == -116:  # ETIMEDOUT
                print('[URLClient] Server check timed out - server might be slow or unreachable')
            elif e.errno == 113:  # ECONNABORTED
                print('[URLClient] Connection aborted - check your network connection')
            elif e.errno == 118:  # EHOSTUNREACH
                print('[URLClient] Host unreachable - check your network connection')
            else:
                print(f'[URLClient] Server check error: {e}')
            return False
        except Exception as e:
            print(f'[URLClient] Unexpected error during server check: {e}')
            return False

# Create a global URLClient instance
url_client = URLClient()

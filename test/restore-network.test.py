import json
from pathlib import Path
import socket
import sys
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'ops'))
from rehearsal_network import FixedLoopbackRelay, container_loopback_port, RehearsalNetworkError

class NetworkTests(unittest.TestCase):
    def test_real_tcp_roundtrip_and_shutdown(self):
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            server.listen(1)
            def echo():
                connection, _ = server.accept()
                with connection:
                    connection.sendall(connection.recv(1024))
            thread = threading.Thread(target=echo)
            thread.start()
            relay = FixedLoopbackRelay(server.getsockname())
            try:
                with socket.create_connection(('127.0.0.1', relay.port), timeout=2) as client:
                    client.sendall(b'isolated-roundtrip')
                    self.assertEqual(client.recv(1024), b'isolated-roundtrip')
            finally:
                relay.close()
                thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertFalse(relay.thread.is_alive())
            with self.assertRaises(OSError):
                socket.create_connection(('127.0.0.1', relay.port), timeout=.2)

    def test_internal_network_without_publish_uses_only_owned_destination(self):
        state = {'running': True, 'ports': {}, 'networks': {'owned': {'NetworkID': 'network-id', 'IPAddress': '172.22.0.2'}}}
        relays, diagnostics = [], []
        with patch('rehearsal_network.FixedLoopbackRelay') as relay:
            relay.return_value.port = 12345
            result = container_loopback_port(lambda _: json.dumps(state), 'container-id', 'network-id', 3306, ['container-id'], relays, diagnostics)
            self.assertEqual(result, 12345)
            relay.assert_called_once_with(('172.22.0.2', 3306))
        self.assertEqual(diagnostics[0]['transport'], 'fixed-loopback-relay')
        self.assertNotIn('172.22', json.dumps(diagnostics))

    def test_unowned_extra_network_or_exited_container_rejected(self):
        for state in [
            {'running': False},
            {'running': True, 'networks': {'wrong': {'NetworkID': 'other'}}},
            {'running': True, 'networks': {'a': {'NetworkID': 'network-id'}, 'b': {'NetworkID': 'external'}}},
        ]:
            with self.subTest(state=state), self.assertRaises(RehearsalNetworkError):
                container_loopback_port(lambda _: json.dumps(state), 'owned', 'network-id', 3000, ['owned'], [], [])
        with self.assertRaises(RehearsalNetworkError):
            container_loopback_port(lambda _: self.fail('must not inspect foreign container'), 'foreign', 'network-id', 3000, ['owned'], [], [])

if __name__ == '__main__':
    unittest.main()

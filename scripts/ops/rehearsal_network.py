"""Fixed loopback relays for owned Linux Docker internal-network containers.

Internal bridges may omit published port bindings. The Docker host can still
reach their bridge IPs. No container receives an external network or a route to
providers; each host relay has exactly one inspected destination, never a proxy
protocol or a user-selected address.
"""
import ipaddress
import json
import select
import socket
import threading
import time


class RehearsalNetworkError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class FixedLoopbackRelay:
    def __init__(self, target, max_connections=8, idle_seconds=30, lifetime_seconds=300):
        address = ipaddress.ip_address(target[0])
        if address.version != 4 or not address.is_private or address.is_unspecified or address.is_multicast:
            raise RehearsalNetworkError('RESTORE_RELAY_TARGET_INVALID')
        if not 0 < int(target[1]) < 65536 or not 1 <= max_connections <= 16:
            raise RehearsalNetworkError('RESTORE_RELAY_LIMIT_INVALID')
        self.target = (str(address), int(target[1]))
        self.idle_seconds, self.lifetime_seconds = idle_seconds, lifetime_seconds
        self.stopping = threading.Event()
        self.limit = threading.BoundedSemaphore(max_connections)
        self.lock = threading.Lock()
        self.sockets, self.workers = set(), set()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(('127.0.0.1', 0))
        self.listener.listen(max_connections)
        self.listener.settimeout(0.2)
        self.port = self.listener.getsockname()[1]
        self.thread = threading.Thread(target=self._accept, name='restore-loopback-accept', daemon=True)
        self.thread.start()

    def _accept(self):
        while not self.stopping.is_set():
            try:
                client, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            if self.stopping.is_set() or not self.limit.acquire(blocking=False):
                client.close()
                continue
            worker = threading.Thread(target=self._forward, args=(client,), name='restore-fixed-forward', daemon=True)
            with self.lock:
                self.workers.add(worker)
                self.sockets.add(client)
            worker.start()

    def _forward(self, client):
        remote = None
        try:
            remote = socket.create_connection(self.target, timeout=2)
            with self.lock:
                self.sockets.add(remote)
            client.settimeout(2)
            remote.settimeout(2)
            started = last_activity = time.monotonic()
            while not self.stopping.is_set():
                now = time.monotonic()
                if now - last_activity > self.idle_seconds or now - started > self.lifetime_seconds:
                    return
                readable, _, _ = select.select([client, remote], [], [], 0.2)
                for source in readable:
                    data = source.recv(65536)
                    if not data:
                        return
                    (remote if source is client else client).sendall(data)
                    last_activity = time.monotonic()
        except (OSError, ValueError):
            pass  # The caller's bounded HTTP/MySQL request reports the failure.
        finally:
            with self.lock:
                for channel in [client, remote]:
                    if channel is not None:
                        self.sockets.discard(channel)
                        channel.close()
                self.workers.discard(threading.current_thread())
            self.limit.release()

    def close(self):
        self.stopping.set()
        self.listener.close()
        with self.lock:
            channels = list(self.sockets)
        for channel in channels:
            try:
                channel.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            channel.close()
        deadline = time.monotonic() + 3
        self.thread.join(timeout=3)
        with self.lock:
            workers = list(self.workers)
        for worker in workers:
            worker.join(timeout=max(0, deadline - time.monotonic()))
        if self.thread.is_alive() or any(worker.is_alive() for worker in workers):
            raise RehearsalNetworkError('RESTORE_RELAY_SHUTDOWN_FAILED')


INSPECT_FORMAT = ('{"running":{{.State.Running}},"restarting":{{.State.Restarting}},'
    '"exitCode":{{.State.ExitCode}},"oomKilled":{{.State.OOMKilled}},'
    '"hasRuntimeError":{{if .State.Error}}true{{else}}false{{end}},'
    '"ports":{{json .NetworkSettings.Ports}},"networks":{{json .NetworkSettings.Networks}}}')


def container_loopback_port(command, container_id, network_id, container_port, owned_containers, relays, diagnostics):
    if container_id not in owned_containers or container_port not in [3000, 3306]:
        raise RehearsalNetworkError('RESTORE_CONTAINER_NOT_OWNED')
    deadline = time.monotonic() + 5
    while True:
        state = json.loads(command(['docker', 'inspect', '--format', INSPECT_FORMAT, container_id]))
        networks = list((state.get('networks') or {}).values())
        owned = [entry for entry in networks if entry.get('NetworkID') == network_id]
        bindings = (state.get('ports') or {}).get(f'{container_port}/tcp') or []
        # Only fixed booleans/counts/status enter artifacts. No environment,
        # container logs, addresses, SQL, credentials or response payloads.
        diagnostic = {'running': bool(state.get('running')), 'restarting': bool(state.get('restarting')),
            'exitCode': state.get('exitCode'), 'oomKilled': bool(state.get('oomKilled')),
            'hasRuntimeError': bool(state.get('hasRuntimeError')), 'attachedNetworks': len(networks),
            'ownedNetworkMatches': len(owned), 'publishedBindings': len(bindings)}
        if not state.get('running') and not state.get('restarting'):
            diagnostics.append(diagnostic)
            raise RehearsalNetworkError('RESTORE_CONTAINER_EXITED')
        if len(networks) != 1 or len(owned) != 1:
            diagnostics.append(diagnostic)
            raise RehearsalNetworkError('RESTORE_CONTAINER_NETWORK_MISMATCH')
        if state.get('running') and bindings:
            if len(bindings) != 1 or bindings[0].get('HostIp') != '127.0.0.1':
                raise RehearsalNetworkError('RESTORE_PORT_NOT_LOOPBACK')
            port = int(bindings[0]['HostPort'])
            if not 0 < port < 65536:
                raise RehearsalNetworkError('RESTORE_PORT_INVALID')
            diagnostic['transport'] = 'published-loopback'
            diagnostics.append(diagnostic)
            return port
        address = owned[0].get('IPAddress')
        if state.get('running') and address:
            parsed = ipaddress.ip_address(address)
            if parsed.version != 4 or not parsed.is_private or parsed.is_loopback or parsed.is_unspecified:
                raise RehearsalNetworkError('RESTORE_CONTAINER_ADDRESS_INVALID')
            relay = FixedLoopbackRelay((str(parsed), container_port))
            relays.append(relay)
            diagnostic['transport'] = 'fixed-loopback-relay'
            diagnostics.append(diagnostic)
            return relay.port
        if time.monotonic() >= deadline:
            diagnostics.append(diagnostic)
            raise RehearsalNetworkError('RESTORE_CONTAINER_ENDPOINT_DEADLINE')
        time.sleep(0.1)

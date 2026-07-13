from __future__ import annotations

import argparse
import json
import os
import secrets
import socket

import uvicorn

from app.security.local_capability import (
    BootstrapError,
    ReadinessIdentity,
    build_readiness_record,
    install_launch_security,
    read_bootstrap_from_stdin,
)

__all__ = ["main"]


def main() -> None:
    args = parse_args()
    if not args.stdio_bootstrap:
        raise SystemExit("The ML service requires authenticated --stdio-bootstrap startup.")

    try:
        bootstrap = read_bootstrap_from_stdin()
    except BootstrapError as exc:
        raise SystemExit(str(exc)) from exc

    from app.main import app

    startup_nonce = secrets.token_urlsafe(24)
    install_launch_security(app, bootstrap, startup_nonce)

    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(2048)
    listener.set_inheritable(False)
    port = int(listener.getsockname()[1])

    readiness = build_readiness_record(
        ReadinessIdentity(
            launch_id=bootstrap.launch_id,
            pid=os.getpid(),
            port=port,
            startup_nonce=startup_nonce,
        )
    )
    write_readiness(args.control_fd, readiness)

    config = uvicorn.Config(
        app,
        host="127.0.0.1",
        port=0,
        reload=False,
        access_log=False,
        log_config=None,
    )
    uvicorn.Server(config).run(sockets=[listener])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="TANAW authenticated local ML service")
    parser.add_argument("--stdio-bootstrap", action="store_true")
    parser.add_argument("--control-fd", type=int, default=3)
    return parser.parse_args()


def write_readiness(control_fd: int, readiness: dict[str, object]) -> None:
    if control_fd < 3:
        raise SystemExit("A private readiness control pipe is required.")
    payload = json.dumps(readiness, separators=(",", ":"), sort_keys=True)
    with os.fdopen(control_fd, "w", encoding="utf-8", closefd=True) as control:
        control.write(payload + "\n")
        control.flush()


if __name__ == "__main__":
    main()

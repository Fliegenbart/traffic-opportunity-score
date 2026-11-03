"""Mobilithek pull client: machine-account certificate (PKCS#12) + subscription pull over HTTPS."""
from __future__ import annotations

import base64
import contextlib
import gzip
import os
import tempfile

import requests
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat, pkcs12

PULL_URL = "https://mobilithek.info:8443/mobilithek/api/v1.0/subscription/{id}/clientPullService?subscriptionID={id}"
SID_DYNAMIC = "1054375451467628544"
SID_STATIC = "1054375558875140096"


@contextlib.contextmanager
def client_cert(p12_b64: str | None = None, password: str | None = None):
    """Yield (cert_path, key_path) for requests; the PEM files only live in a private temp dir."""
    p12_b64 = p12_b64 or os.environ["MOBILITHEK_CERT_P12"]
    password = password if password is not None else os.environ["MOBILITHEK_CERT_PASSWORD"]
    key, cert, chain = pkcs12.load_key_and_certificates(base64.b64decode(p12_b64), password.encode())
    with tempfile.TemporaryDirectory() as tmp:
        cert_path, key_path = os.path.join(tmp, "cert.pem"), os.path.join(tmp, "key.pem")
        with open(cert_path, "wb") as out:
            out.write(cert.public_bytes(Encoding.PEM) + b"".join(c.public_bytes(Encoding.PEM) for c in chain or []))
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()))
        yield cert_path, key_path


def pull(subscription_id: str, cert: tuple[str, str], timeout: int = 120) -> bytes:
    response = requests.get(PULL_URL.format(id=subscription_id), cert=cert, timeout=timeout,
                            headers={"Accept-Encoding": "gzip"})
    response.raise_for_status()
    body = response.content
    return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body

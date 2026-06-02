#!/usr/bin/env python3
"""
ProPresenter 7 WebSocket Proxy
wss://0.0.0.0:1028  →  ws://127.0.0.1:5004

사용법:
  pip3 install websockets
  python3 pp_ws_proxy.py
"""
import asyncio, ssl, sys, subprocess, pathlib

try:
    import websockets
except ImportError:
    print("먼저 설치: pip3 install websockets")
    sys.exit(1)

PP_HOST  = "127.0.0.1"
PP_PORT  = 5004
LISTEN   = 1028

# 인증서 — 처음 한 번만 생성, 이후 재사용
cert_path = pathlib.Path.home() / ".tvpc_ws.crt"
key_path  = pathlib.Path.home() / ".tvpc_ws.key"

if not cert_path.exists() or not key_path.exists():
    print("인증서 생성 중...")
    result = subprocess.run([
        "openssl", "req", "-x509", "-newkey", "rsa:2048",
        "-keyout", str(key_path), "-out", str(cert_path),
        "-days", "3650", "-nodes", "-subj", "/CN=localhost"
    ], capture_output=True)
    if result.returncode != 0:
        print("openssl 오류:", result.stderr.decode())
        sys.exit(1)
    print(f"인증서 저장됨: {cert_path}")
else:
    print(f"기존 인증서 사용: {cert_path}")

async def relay(src, dst):
    try:
        async for msg in src:
            await dst.send(msg)
    except Exception:
        pass

async def handler(client):
    print(f"클라이언트 연결: {client.remote_address}")
    try:
        async with websockets.connect(
            f"ws://{PP_HOST}:{PP_PORT}/",
            open_timeout=5,
            ping_interval=None,
        ) as pp:
            print("PP 연결 성공 ✓")
            t1 = asyncio.create_task(relay(client, pp))
            t2 = asyncio.create_task(relay(pp, client))
            done, pending = await asyncio.wait(
                [t1, t2], return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
    except Exception as e:
        print(f"PP 연결 실패: {e}")
    finally:
        print(f"연결 종료: {client.remote_address}")

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(str(cert_path), str(key_path))

async def main():
    async with websockets.serve(handler, "0.0.0.0", LISTEN, ssl=ctx):
        print()
        print(f"✓ PP7 WebSocket 프록시 시작")
        print(f"  wss://0.0.0.0:{LISTEN}  →  ws://{PP_HOST}:{PP_PORT}/")
        print()
        print(f"─── 기기별 인증서 수락 (처음 한 번만) ───")
        print(f"  브라우저에서 https://192.168.1.21:{LISTEN}/ 열고")
        print(f"  '고급' → '계속 진행' 클릭")
        print()
        await asyncio.Future()

asyncio.run(main())

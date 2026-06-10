#!/usr/bin/env python3
"""
ProPresenter 7 WebSocket Proxy
wss://0.0.0.0:1028  →  ws://127.0.0.1:5004/<path>

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

# PP7 WebSocket 경로 후보 (순서대로 시도)
WS_PATHS = [
    "/v1/",
    "/v1/status",
    "/v1/presentation/active",
    "/",
]

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

# 성공한 경로를 기억
working_path = None

async def find_pp_ws_path():
    """PP7 WebSocket이 응답하는 경로를 찾아서 반환"""
    for path in WS_PATHS:
        try:
            uri = f"ws://{PP_HOST}:{PP_PORT}{path}"
            ws = await websockets.connect(uri, open_timeout=3, ping_interval=None)
            await ws.close()
            print(f"PP WebSocket 경로 발견: {path}")
            return path
        except Exception as e:
            err = str(e)
            if "404" not in err and "rejected" not in err:
                # 404가 아닌 오류 (연결 거부 등) — PP 자체가 꺼진 경우
                print(f"  {path} → {err}")
            else:
                print(f"  {path} → 404")
    return None

async def relay(src, dst):
    try:
        async for msg in src:
            await dst.send(msg)
    except Exception:
        pass

async def handler(client):
    global working_path
    print(f"클라이언트 연결: {client.remote_address}")

    if working_path is None:
        print("PP WebSocket 경로 탐색 중...")
        working_path = await find_pp_ws_path()
        if working_path is None:
            print("PP WebSocket 경로를 찾지 못했어요.")
            await client.close()
            return

    try:
        async with websockets.connect(
            f"ws://{PP_HOST}:{PP_PORT}{working_path}",
            open_timeout=5,
            ping_interval=None,
        ) as pp:
            print(f"PP 연결 성공 ✓  ({working_path})")
            t1 = asyncio.create_task(relay(client, pp))
            t2 = asyncio.create_task(relay(pp, client))
            done, pending = await asyncio.wait(
                [t1, t2], return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
    except Exception as e:
        working_path = None  # 다음 연결에서 다시 탐색
        print(f"PP 연결 실패: {e}")
    finally:
        print(f"연결 종료: {client.remote_address}")

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(str(cert_path), str(key_path))

async def main():
    # 시작 시 경로 탐색
    global working_path
    print("PP WebSocket 경로 탐색 중...")
    working_path = await find_pp_ws_path()
    if working_path:
        print(f"사용할 경로: {working_path}")
    else:
        print("경로 못 찾음 — 클라이언트 연결 시 재시도합니다")

    async with websockets.serve(handler, "0.0.0.0", LISTEN, ssl=ctx):
        print()
        print(f"✓ PP7 WebSocket 프록시 시작")
        print(f"  wss://0.0.0.0:{LISTEN}  →  ws://{PP_HOST}:{PP_PORT}{working_path or '/?'}")
        print()
        await asyncio.Future()

asyncio.run(main())

#!/usr/bin/env python3
"""
ProPresenter 7 WebSocket Proxy
wss://0.0.0.0:1028  →  ws://127.0.0.1:5004

사용법:
  pip3 install websockets
  python3 pp_ws_proxy.py [cert.pem] [key.pem]

cert/key 파일을 지정 안 하면 기존 REST 프록시와 같은 위치에서 자동 탐색.
"""
import asyncio, ssl, sys, pathlib

try:
    import websockets
except ImportError:
    print("먼저 설치: pip3 install websockets")
    sys.exit(1)

PP_HOST   = "127.0.0.1"
PP_PORT   = 5004
LISTEN    = 1028

def find_file(candidates):
    search_dirs = [pathlib.Path.home(), pathlib.Path("."), pathlib.Path.home() / "ssl"]
    for name in candidates:
        for base in search_dirs:
            p = base / name
            if p.exists():
                return str(p)
    return None

cert = sys.argv[1] if len(sys.argv) > 1 else find_file(["cert.pem", "server.crt"])
key  = sys.argv[2] if len(sys.argv) > 2 else find_file(["key.pem",  "server.key"])

if not cert or not key:
    print("cert.pem / key.pem 파일을 찾을 수 없어요.")
    print("인수로 직접 지정하세요:")
    print("  python3 pp_ws_proxy.py /path/to/cert.pem /path/to/key.pem")
    sys.exit(1)

async def relay(src, dst, label):
    try:
        async for msg in src:
            await dst.send(msg)
    except Exception:
        pass

async def handler(client):
    addr = client.remote_address
    print(f"연결: {addr}")
    try:
        async with websockets.connect(
            f"ws://{PP_HOST}:{PP_PORT}/",
            open_timeout=5,
            ping_interval=None,
        ) as pp:
            print(f"PP 연결됨 ← {addr}")
            t1 = asyncio.create_task(relay(client, pp, "→PP"))
            t2 = asyncio.create_task(relay(pp, client, "→앱"))
            done, pending = await asyncio.wait(
                [t1, t2], return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
    except Exception as e:
        print(f"오류: {e}")
    finally:
        print(f"종료: {addr}")

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)

async def main():
    async with websockets.serve(handler, "0.0.0.0", LISTEN, ssl=ctx):
        print(f"✓ PP7 WebSocket 프록시 시작")
        print(f"  wss://0.0.0.0:{LISTEN}  →  ws://{PP_HOST}:{PP_PORT}/")
        print(f"  cert: {cert}")
        print(f"  key : {key}")
        print(f"  슬라이드를 클릭하면 메시지가 표시됩니다...")
        await asyncio.Future()

asyncio.run(main())

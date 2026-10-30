import os, sys, socket
root = '/Users/gold/Desktop/Deepseek/video-workbench'
node = '/Users/gold/.nvm/versions/node/v22.19.0/bin/node'
log = os.path.join(root, 'data', 'server.log')


def proxy_alive(host='127.0.0.1', port=7892):
    sock = socket.socket()
    sock.settimeout(0.3)
    try:
        sock.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        sock.close()


if os.fork() > 0:
    sys.exit(0)
os.setsid()
if os.fork() > 0:
    sys.exit(0)
os.chdir(root)
# 本機代理沒開就不要硬塞 HTTPS_PROXY，否則所有模型請求都會 fetch failed
if proxy_alive():
    os.environ['HTTPS_PROXY'] = 'http://127.0.0.1:7892'
else:
    os.environ.pop('HTTPS_PROXY', None)
os.environ['PATH'] = '/Users/gold/.nvm/versions/node/v22.19.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(fd, 1)
os.dup2(fd, 2)
os.execv(node, [node, 'server/index.mjs'])

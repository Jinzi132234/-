import os, sys
root = '/Users/gold/Desktop/Deepseek/video-workbench'
node = '/Users/gold/.nvm/versions/node/v22.19.0/bin/node'
log = os.path.join(root, 'data', 'server.log')
if os.fork() > 0:
    sys.exit(0)
os.setsid()
if os.fork() > 0:
    sys.exit(0)
os.chdir(root)
os.environ['HTTPS_PROXY'] = 'http://127.0.0.1:7892'
os.environ['PATH'] = '/Users/gold/.nvm/versions/node/v22.19.0/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(fd, 1)
os.dup2(fd, 2)
os.execv(node, [node, 'server/index.mjs'])

import { randomBytes, scryptSync } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { db, one, exec, now, uid, transaction, dataRoot } from '../server/db.mjs';

function askPassword(label) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      reject(new Error('首次创建管理员需要交互式终端，请直接在 Mac Terminal 中运行 make dev'));
      return;
    }
    const stdin = process.stdin;
    let input = '';
    let done = false;
    const finish = (error) => {
      if (done) return;
      done = true;
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(input);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003' || char === '\u0004') return finish(new Error('输入已取消'));
        if (char === '\r' || char === '\n') return finish();
        if (char === '\u007f' || char === '\b') {
          input = input.slice(0, -1);
        } else if (char >= ' ') {
          input += char;
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    process.stdout.write(label);
  });
}

async function initializeAdminIfNeeded() {
  if (one('SELECT COUNT(*) AS n FROM users').n !== 0) return;
  if (!process.stdin.isTTY) throw new Error('本地测试数据库没有管理员账号。请在 Mac Terminal 中执行 make dev 并设置密码。');

  console.log('\n首次启动：初始化本地测试管理员（不会创建默认账号密码）');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let username;
  try {
    username = (await rl.question('管理员用户名（默认 admin）: ')).trim() || 'admin';
  } finally {
    rl.close();
  }
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) throw new Error('用户名只能使用3-40个字母、数字、下划线、点或短横线');

  const password = await askPassword('设置管理员密码（输入不显示）: ');
  const confirmation = await askPassword('再次输入管理员密码: ');
  if (password !== confirmation) throw new Error('两次密码不一致，未创建账号');
  if (password.length === 0) throw new Error('密码不能为空');
  if (one('SELECT COUNT(*) AS n FROM users').n !== 0) throw new Error('已有管理员账号，停止重复初始化');

  const salt = randomBytes(16).toString('hex');
  const hash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
  transaction(() => exec('INSERT INTO users VALUES(?,?,?,?,?,?)', uid(), username, hash, 'admin', 'active', now()));
  console.log('管理员初始化成功：' + username);
}

try {
  await initializeAdminIfNeeded();
  console.log('\n本地开发测试数据：' + dataRoot);
  const host = process.env.HOST || '127.0.0.1';
  const port = process.env.PORT || '8787';
  console.log('本机访问：http://127.0.0.1:' + port);
  if (host === '0.0.0.0' || host === '::') {
    const addresses = Object.entries(networkInterfaces())
      .filter(([name]) => /^(en\d+|eth\d+|wlan\d+|bridge\d+)$/.test(name))
      .flatMap(([,entries]) => entries || [])
      .filter(x => x.family === 'IPv4' && !x.internal).map(x => x.address);
    for (const address of [...new Set(addresses)]) {
      console.log('局域网访问：http://' + address + ':' + port);
    }
    console.log('仅允许管理员已授权的远程 IP；服务器本机仍可访问。');
  } else {
    console.log('当前监听地址：' + host + '（如果是 127.0.0.1，局域网设备无法访问）');
  }
  console.log('按 Ctrl+C 停止服务。\n');
  await import('../server/server.mjs');
} catch (error) {
  console.error('启动失败：' + error.message);
  db.close();
  process.exitCode = 1;
}

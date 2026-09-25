// 一次性验收服务的就绪等待：轮询 web 直到可访问，然后 exec 后续命令。
// 仅使用 Node 内置能力，不依赖镜像内是否存在 wget/curl。
// 用法：node scripts/wait-for-web.mjs npx playwright test
import { spawn } from 'node:child_process';
import process from 'node:process';

const url = process.env.WAIT_FOR_URL ?? 'http://web:80/';
const timeoutMs = Number(process.env.WAIT_TIMEOUT_MS ?? 60_000);
const deadline = Date.now() + timeoutMs;
const [cmd, ...args] = process.argv.slice(2);

if (!cmd) {
  console.error('[wait-for-web] 缺少就绪后要执行的命令');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let attempt = 0;
while (true) {
  attempt++;
  try {
    const res = await fetch(url);
    if (res.ok) {
      console.log(`[wait-for-web] ${url} 已就绪（第 ${attempt} 次尝试），执行：${cmd} ${args.join(' ')}`);
      break;
    }
  } catch {
    // 连接被拒绝/尚未监听，继续等待
  }
  if (Date.now() > deadline) {
    console.error(`[wait-for-web] 等待 ${url} 超时（${timeoutMs}ms）`);
    process.exit(1);
  }
  await sleep(1000);
}

// 以子进程运行验收命令，stdio 直通；退出码即验收结论
const child = spawn(cmd, args, { stdio: 'inherit' });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

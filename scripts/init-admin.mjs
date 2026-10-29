import { randomBytes, scryptSync } from 'node:crypto';
import { one,exec,uid,now,transaction } from '../server/db.mjs';
const username=(process.env.SD_ADMIN_USER||'').trim(),password=process.env.SD_ADMIN_PASSWORD||'';
if(one('SELECT COUNT(*) AS n FROM users').n>0){
 console.error('管理员初始化已完成。请使用现有账号登录，脚本不会覆盖已有用户或密码。');
 process.exit(1);
}
if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||password.length===0){
 console.error('用户名应为3-40个字母、数字、下划线或点；密码不能为空。');
 process.exit(2);
}
const salt=randomBytes(16).toString('hex');
const hash=salt+':'+scryptSync(password,salt,64).toString('hex');
transaction(()=>exec('INSERT INTO users VALUES(?,?,?,?,?,?)',uid(),username,hash,'admin','active',now()));
console.log('管理员初始化成功：'+username);

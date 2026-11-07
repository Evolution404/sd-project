import {db} from '../connection.mjs';

export const userCount=()=>db.prepare('SELECT COUNT(*) n FROM users').get().n;
export function createFirstAdmin(id,username,passwordHash,time){
 // Recheck inside the database write transaction: no concurrent first-admin bypass.
 if(userCount()!==0)throw Object.assign(new Error('已有管理员账号，停止重复初始化'),{status:409});
 db.prepare(`INSERT INTO users
 (id,username,password_hash,role,status,created_at)
 VALUES(?,?,?,'admin','active',?)`).run(id,username,passwordHash,time);
}

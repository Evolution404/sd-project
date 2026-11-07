import {db} from '../connection.mjs';

// This module alone owns the session/user/IP SQL.
// Network parsing, permissions and decisions stay in HTTP/application.
export function firstAdminActor(){
 return db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY created_at,id LIMIT 1").get();
}
export function userByUsername(username){
 return db.prepare('SELECT * FROM users WHERE username=?').get(username);
}
export function activeUserForSession(tokenHash,now){
 return db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
 WHERE s.token_hash=? AND s.expires_at>? AND u.status='active'`).get(tokenHash,now);
}
export function createSession(tokenHash,userId,expiresAt,createdAt){
 db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
  .run(tokenHash,userId,expiresAt,createdAt);
}
export function removeSession(tokenHash){
 db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
}
export function allowedIP(ip){
 return !!db.prepare('SELECT 1 FROM allowed_ips WHERE ip=?').get(ip);
}
export function listAllowedIPs(){
 return db.prepare(`SELECT a.*,u.username AS created_by_name FROM allowed_ips a
 LEFT JOIN users u ON u.id=a.created_by ORDER BY a.created_at,a.ip`).all();
}
export function allowedIPById(id){
 return db.prepare('SELECT * FROM allowed_ips WHERE id=?').get(id);
}
export function insertAllowedIP(item){
 db.prepare(`INSERT INTO allowed_ips(id,ip,note,created_by,created_at)
 VALUES(?,?,?,?,?)`).run(item.id,item.ip,item.note,item.created_by,item.created_at);
}
export function deleteAllowedIP(id){
 db.prepare('DELETE FROM allowed_ips WHERE id=?').run(id);
}

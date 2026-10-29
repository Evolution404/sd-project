import { isIP } from 'node:net';
import { one } from './db.mjs';

/** Exact host-address matching only. Never use proxy-supplied X-Forwarded-For. */
export function normalizeIP(value) {
 if(typeof value!=='string')return null;
 const ip=value.trim();
 if(!ip || ip.includes('%'))return null;
 if(isIP(ip)===4)return ip.split('.').map(x=>String(Number(x))).join('.');
 if(isIP(ip)!==6)return null;
 const mapped=ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
 if(mapped && isIP(mapped[1])===4)return normalizeIP(mapped[1]);
 return new URL('http://['+ip+']/').hostname.slice(1,-1).toLowerCase();
}
export function isLoopback(ip) {
 return ip==='127.0.0.1'||ip==='::1';
}
export function isPermittedIP(peer) {
 const ip=normalizeIP(peer);
 if(!ip)return false;
 if(isLoopback(ip))return true; // local-only recovery/initial provisioning
 return Boolean(one('SELECT 1 FROM allowed_ips WHERE ip=?',ip));
}

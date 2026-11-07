import {db} from './connection.mjs';

// Node DatabaseSync executes synchronously; no awaits inside a write transaction.
export function transaction(fn){
 db.exec('BEGIN IMMEDIATE');
 try{const result=fn();db.exec('COMMIT');return result}
 catch(error){db.exec('ROLLBACK');throw error}
}

import pg from 'pg';
import {readFile} from 'node:fs/promises';
if(!process.env.UNION_DATABASE_URL)throw new Error('UNION_DATABASE_URL is required in the protected environment.');
const client=new pg.Client({connectionString:process.env.UNION_DATABASE_URL});
try{await client.connect();await client.query(await readFile(new URL('../server/schema.sql',import.meta.url),'utf8'));console.log('Union service tables are ready.');}finally{await client.end();}

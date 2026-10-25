import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
export const hash = value => createHash('sha256').update(value).digest('hex');
export class Fault extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireThat(ok, message, status = 409) { if (!ok) throw new Fault(status, message); }
export function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length > 20 &&
    timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
export class Store {
  constructor(db) { this.db = db; }
  async transaction(work) {
    // pg Pool in production; PGlite's transaction adapter in integration tests.
    if (this.db.transaction) return this.db.transaction(client => work(client));
    const client = await this.db.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
  }
  async create(quote) {
    const customerToken = randomBytes(32).toString('base64url');
    const providerToken = randomBytes(32).toString('base64url');
    const data = {...quote, id: randomUUID(), state: 'quoted', revision: 0, currency: 'usd'};
    await this.transaction(async client => {
      await client.query('INSERT INTO union_orders(id,customer_hash,provider_hash,data) VALUES($1,$2,$3,$4)',
        [data.id, hash(customerToken), hash(providerToken), JSON.stringify(data)]);
      await client.query('INSERT INTO union_audit(order_id,action,actor) VALUES($1,$2,$3)', [data.id,'quote_created','operator']);
    });
    return {order:data, customerToken, providerToken};
  }
  async locked(id, actor, token, work) {
    return this.transaction(async client => {
      const {rows} = await client.query('SELECT * FROM union_orders WHERE id=$1 FOR UPDATE', [id]);
      const row = rows[0]; requireThat(row, 'Order not found.', 404);
      if (actor === 'customer' || actor === 'provider') {
        requireThat(typeof token === 'string' && equalSecret(hash(token),row[actor+'_hash']), 'Invalid order access.', 401);
      }
      const order = row.data;
      const audit = async (action, detail={}) => client.query(
        'INSERT INTO union_audit(order_id,action,actor,detail) VALUES($1,$2,$3,$4)', [id,action,actor,JSON.stringify(detail)]);
      const result = await work(order, client, audit);
      await client.query('UPDATE union_orders SET data=$2,updated_at=now() WHERE id=$1',[id,JSON.stringify(order)]);
      return result;
    });
  }
}

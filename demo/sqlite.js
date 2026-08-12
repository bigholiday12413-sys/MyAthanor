/* sql.js（WASM の SQLite）を node:sqlite と同じ形にかぶせる。
   これがあると src/store.js を1行も変えずにブラウザで動かせるので、
   プレビュー版のために本体のロジックを書き写さずに済む。 */

// node:sqlite は真偽値や undefined も受け付けるが、sql.js は受け付けない。
function bindable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

class Statement {
  constructor(owner, sql) {
    this.owner = owner;
    this.sql = sql;
  }

  #rows(params) {
    const stmt = this.owner.raw.prepare(this.sql);
    try {
      if (params.length) stmt.bind(params.map(bindable));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  all(...params) {
    return this.#rows(params);
  }

  get(...params) {
    return this.#rows(params)[0];
  }

  run(...params) {
    this.#rows(params);
    const [row] = this.owner.raw.exec('SELECT last_insert_rowid() AS id');
    this.owner.touch();
    return {
      changes: this.owner.raw.getRowsModified(),
      lastInsertRowid: row?.values?.[0]?.[0] ?? 0,
    };
  }
}

export class BrowserDatabase {
  constructor(raw) {
    this.raw = raw;
    this.onChange = null;
  }

  touch() {
    this.onChange?.();
  }

  exec(sql) {
    this.raw.exec(sql);
    this.touch();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  export() {
    return this.raw.export();
  }
}

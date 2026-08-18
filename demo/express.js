/* express の Router のうち、src/routes.js が使うぶんだけを真似る。
   これがあると routes.js も書き写さずに済み、パスと処理の対応が
   本体とプレビュー版で食い違わない。 */

const PARAM = /^:(.+)$/;

function match(pattern, path) {
  const want = pattern.split('/').filter(Boolean);
  const got = path.split('/').filter(Boolean);
  if (want.length !== got.length) return null;

  const params = {};
  for (let i = 0; i < want.length; i += 1) {
    const key = PARAM.exec(want[i]);
    if (key) params[key[1]] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

export function Router() {
  const routes = [];
  const middleware = [];

  const add = (method) => (path, handler) => routes.push({ method, path, handler });

  const router = {
    get: add('GET'),
    post: add('POST'),
    put: add('PUT'),
    patch: add('PATCH'),
    delete: add('DELETE'),
    use: (fn) => middleware.push(fn),

    // メソッドとパスから1件だけ選んで走らせる。express の next() は
    // 「エラーを投げる」以外に使っていないので、そこだけ拾えばよい。
    handle(method, path, query, body) {
      for (const fn of middleware) {
        let failure = null;
        fn({}, {}, (err) => {
          failure = err;
        });
        if (failure) throw failure;
      }

      for (const route of routes) {
        if (route.method !== method) continue;
        const params = match(route.path, path);
        if (!params) continue;

        const req = { params, query, body };
        let status = 200;
        let payload;
        const res = {
          status(code) {
            status = code;
            return res;
          },
          json(data) {
            payload = data;
            return res;
          },
        };

        let failure = null;
        route.handler(req, res, (err) => {
          failure = err;
        });
        if (failure) throw failure;
        return { status, payload };
      }

      const err = new Error('not found');
      err.status = 404;
      throw err;
    },
  };

  return router;
}

export default { Router };

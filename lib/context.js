
'use strict';

/**
 * Module dependencies.
 */

const createError = require('http-errors');
const httpAssert = require('http-assert');
const delegate = require('delegates');
const statuses = require('statuses');

/**
 * Context prototype.
 */

const proto = module.exports = {

  /**
   * util.inspect() implementation, which
   * just returns the JSON output.
   *
   * @return {Object}
   * @api public
   */

  inspect() {
    if (this === proto) return this;
    return this.toJSON();
  },

  /**
   * Return JSON representation.
   *
   * Here we explicitly invoke .toJSON() on each
   * object, as iteration will otherwise fail due
   * to the getters and cause utilities such as
   * clone() to fail.
   *
   * @return {Object}
   * @api public
   */

  toJSON() {
    return {
      request: this.request.toJSON(),
      response: this.response.toJSON(),
      app: this.app.toJSON(),
      originalUrl: this.originalUrl,
      req: '<original node req>',
      res: '<original node res>',
      socket: '<original node socket>'
    };
  },

  /**
   * Similar to .throw(), adds assertion.
   *
   *    this.assert(this.user, 401, 'Please login!');
   *
   * See: https://github.com/jshttp/http-assert
   *
   * @param {Mixed} test
   * @param {Number} status
   * @param {String} message
   * @api public
   */

  assert: httpAssert,

  /**
   * Throw an error with `msg` and optional `status`
   * defaulting to 500. Note that these are user-level
   * errors, and the message may be exposed to the client.
   *
   *    this.throw(403)
   *    this.throw('name required', 400)
   *    this.throw(400, 'name required')
   *    this.throw('something exploded')
   *    this.throw(new Error('invalid'), 400);
   *    this.throw(400, new Error('invalid'));
   *
   * See: https://github.com/jshttp/http-errors
   *
   * @param {String|Number|Error} err, msg or status
   * @param {String|Number|Error} [err, msg or status]
   * @param {Object} [props]
   * @api public
   */

  throw(...args) {
    throw createError(...args);
  },

  /**
   * Default error handling.
   *
   * @param {Error} err
   * @api private
   */

  onerror(err) {
    // don't do anything if there is no error.
    // this allows you to pass `this.onerror`
    // to node-style callbacks.
    //没有错误时直接返回，不作任何处理
    if (null == err) return;

    if (!(err instanceof Error)) err = new Error(`non-error thrown: ${err}`);

    let headerSent = false;
    if (this.headerSent || !this.writable) {
      //设置头部发送标记
      headerSent = err.headerSent = true;
    }
    //触发app的error事件，app.onError
    // delegate
    this.app.emit('error', err, this);

    // nothing we can do here other
    // than delegate to the app-level
    // handler and log.
    //头部发送后啥都不作，只由app.onError作记录
    if (headerSent) {
      return;
    }

    const { res } = this;

    // first unset all headers
    //移除所有已经设置好的头部
    if (typeof res.getHeaderNames === 'function') {
      res.getHeaderNames().forEach(name => res.removeHeader(name));
    } else {
      //兼容7.7以下node版本
      res._headers = {}; // Node < 7.7
    }

    // then set those specified
    //设置err.headers中指定的头部
    this.set(err.headers);

    // force text/plain
    this.type = 'text';

    // ENOENT support
    //文件不存在错误：如果不是查找不到静态文件，而是node的依赖文件找不到，也会触发404错误
    if ('ENOENT' == err.code) err.status = 404;

    // default to 500
    //其它未知状态码，使用500：服务器内部错误
    if ('number' != typeof err.status || !statuses[err.status]) err.status = 500;

    // respond
    const code = statuses[err.status];
    const msg = err.expose ? err.message : code;
    this.status = err.status;
    this.length = Buffer.byteLength(msg);
    //输出错误到http响应response
    this.res.end(msg);
  }
};

/**
 * Response delegation.
 */
//代理到到ctx.xxx方法到ctx.response.xxx方法
delegate(proto, 'response')
  .method('attachment')
  .method('redirect')
  .method('remove')
  .method('vary')
  .method('set')
  .method('append')
  .method('flushHeaders')
  .access('status')
  .access('message')
  .access('body')
  .access('length')
  .access('type')
  .access('lastModified')
  .access('etag')
  .getter('headerSent')
  .getter('writable');

/**
 * Request delegation.
 */

//代理到到ctx.xxx方法到ctx.request.xxx方法
delegate(proto, 'request')
  .method('acceptsLanguages')
  .method('acceptsEncodings')
  .method('acceptsCharsets')
  .method('accepts')
  .method('get')
  .method('is')
  .access('querystring')
  .access('idempotent')
  .access('socket')
  .access('search')
  .access('method')
  .access('query')
  .access('path')
  .access('url')
  .getter('origin')
  .getter('href')
  .getter('subdomains')
  .getter('protocol')
  .getter('host')
  .getter('hostname')
  .getter('URL')
  .getter('header')
  .getter('headers')
  .getter('secure')
  .getter('stale')
  .getter('fresh')
  .getter('ips')
  .getter('ip');

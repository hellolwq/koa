'use strict'

/**
 * Module dependencies.
 */

const isGeneratorFunction = require('is-generator-function')
const debug = require('debug')('koa:application')
const onFinished = require('on-finished')
const response = require('./response')
// middlewares处理组件，50不到，是否有必要抽象成一个组件？
const compose = require('koa-compose')
const isJSON = require('koa-is-json')
const context = require('./context')
const request = require('./request')
const statuses = require('statuses')
const Cookies = require('cookies')
const accepts = require('accepts')
const Emitter = require('events')
const assert = require('assert')
const Stream = require('stream')
const http = require('http')
const only = require('only')
const convert = require('koa-convert')
const deprecate = require('depd')('koa')

/**
 * Expose `Application` class.
 * Inherits from `Emitter.prototype`.
 */
//application定义为class,resposne、context、request都定义为对象了，http请求里面直接用Object.create(xxx)的方式实现了继承并生成子对象，还避免了new XXX这类带来的继承问题；
module.exports = class Application extends Emitter {
  /**
   * Initialize a new `Application`.
   *
   * @api public
   */

  constructor () {
    super()

    this.proxy = false
    this.middleware = []
    this.subdomainOffset = 2
    this.env = process.env.NODE_ENV || 'development'
    //app.context继承自context对象
    this.context = Object.create(context)
    this.request = Object.create(request)
    this.response = Object.create(response)
  }

  /**
   * Shorthand for:
   *
   *    http.createServer(app.callback()).listen(...)
   *
   * @param {Mixed} ...
   * @return {Server}
   * @api public
   */

  listen (...args) {
    debug('listen')
    //创建、监听http服务
    const server = http.createServer(this.callback())
    return server.listen(...args)
  }

  /**
   * Return JSON representation.
   * We only bother showing settings.
   *
   * @return {Object}
   * @api public
   */

  toJSON () {
    return only(this, [
      'subdomainOffset',
      'proxy',
      'env'
    ])
  }

  /**
   * Inspect implementation.
   *
   * @return {Object}
   * @api public
   */

  inspect () {
    return this.toJSON()
  }

  /**
   * Use the given middleware `fn`.
   *
   * Old-style middleware will be converted.
   *
   * @param {Function} fn
   * @return {Application} self
   * @api public
   */

  use (fn) {
    if (typeof fn !== 'function') throw new TypeError(
      'middleware must be a function!')
    //兼容generator函数用法
    if (isGeneratorFunction(fn)) {
      deprecate('Support for generators will be removed in v3. ' +
        'See the documentation for examples of how to convert old middleware ' +
        'https://github.com/koajs/koa/blob/master/docs/migration.md')
      fn = convert(fn)
    }
    debug('use %s', fn._name || fn.name || '-')
    //中间件入数组栈
    this.middleware.push(fn)
    return this
  }

  /**
   * Return a request handler callback
   * for node's native http server.
   *
   * @return {Function}
   * @api public
   */

  callback () {
    //默认不传next函数，只在启动的时候compose函数调用一次
    const fn = compose(this.middleware)

    if (!this.listeners('error').length) this.on('error', this.onerror)

    const handleRequest = (req, res) => {
      //创建上下文，express使用的是fn(req,req,next)形式中间件，koa使用fn(ctx,next)，req,res上面的属性有比较大的区别了
      const ctx = this.createContext(req, res)
      return this.handleRequest(ctx, fn)
    }
    //每次http请求都调用
    return handleRequest
  }

  /**
   * Handle request in callback.
   *
   * @api private
   */

  handleRequest (ctx, fnMiddleware) {
    const res = ctx.res
    res.statusCode = 404
    //使用ctx.onerror作为出错处理函数，在中间件最后catch
    const onerror = err => ctx.onerror(err)
    //封装中间件后的响应reponse函数
    const handleResponse = () => respond(ctx)
    //ctx.req.socket end、finish的时候出发onerror函数
    onFinished(res, onerror)
    return fnMiddleware(ctx).then(handleResponse).catch(onerror)
  }

  /**
   * Initialize a new context.
   *
   * @api private
   */

  createContext (req, res) {
    const context = Object.create(this.context)
    //每次连接的request继承自app.request
    const request = context.request = Object.create(this.request)
    //每次连接的response继承自app.response
    const response = context.response = Object.create(this.response)
    context.app = request.app = response.app = this
    //context、request、response的req、res对象指向node原始的incommintMessage和response对象
    context.req = request.req = response.req = req
    context.res = request.res = response.res = res
    //连接级的ctx对象继承自context
    request.ctx = response.ctx = context
    request.response = response
    response.request = request
    context.originalUrl = request.originalUrl = req.url
    context.cookies = new Cookies(req, res, {
      keys: this.keys,
      secure: request.secure
    })
    request.ip = request.ips[0] || req.socket.remoteAddress || ''
    context.accept = request.accept = accepts(req)
    context.state = {}
    return context
  }

  /**
   * Default error handler.
   *
   * @param {Error} err
   * @api private
   */

  onerror (err) {
    assert(err instanceof Error, `non-error thrown: ${err}`)
    //页面是404或者err.expose==true
    if (404 == err.status || err.expose) return
    //app.silent的时候不报错，默认silent为undefined
    if (this.silent) return
    //错误处理分两级,ctx的错误会先发一份到app，用于打日志、然后再输出到http的response
    const msg = err.stack || err.toString()
    console.error()//flush??
    console.error(msg.replace(/^/gm, '  '))
    console.error()
  }
}

/**
 * Response helper.
 */

function respond (ctx) {
  // allow bypassing koa
  if (false === ctx.respond) return
  //ctx不可写的时候，直接返回
  const res = ctx.res
  if (!ctx.writable) return

  let body = ctx.body
  const code = ctx.status

  // ignore body
  if (statuses.empty[code]) {
    // strip headers
    ctx.body = null
    return res.end()
  }

  if ('HEAD' == ctx.method) {
    if (!res.headersSent && isJSON(body)) {
      ctx.length = Buffer.byteLength(JSON.stringify(body))
    }
    return res.end()
  }

  // status body
  if (null == body) {
    body = ctx.message || String(code)
    if (!res.headersSent) {
      ctx.type = 'text'
      ctx.length = Buffer.byteLength(body)
    }
    return res.end(body)
  }

  // responses
  if (Buffer.isBuffer(body)) return res.end(body)
  if ('string' == typeof body) return res.end(body)
  if (body instanceof Stream) return body.pipe(res)

  // body: json
  body = JSON.stringify(body)
  if (!res.headersSent) {
    ctx.length = Buffer.byteLength(body)
  }
  res.end(body)
}

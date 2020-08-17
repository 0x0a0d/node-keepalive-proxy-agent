const https = require('https')
const net = require('net')
const tls = require('tls')
const url = require('url')
const isHttpsProxy = require('is-https-proxy')

function getEnvProxy () {
  const envKeys = Object.keys(process.env)
  const keyIndex = envKeys.findIndex(key => key.toLowerCase() === 'https_proxy')
  if (keyIndex === -1) {
    return
  }
  const { hostname, port, username, password } = new url.URL(process.env[envKeys[keyIndex]])
  if (username != null && password != null) {
    return { hostname, port, auth: `${username}:${password}` }
  } else {
    return { hostname, port }
  }
}

class myAgent extends https.Agent {
  constructor (options) {
    options = options || {}
    const proxy = options.proxy || getEnvProxy()
    delete options.proxy
    if (options.keepAlive == null) {
      options.keepAlive = true
    }
    super(options)

    this.proxy = proxy
  }

  createConnectionHttpsAfterHttp (options, cb) {
    const proxySocket = (this.proxy.isHttps ? tls : net).connect(this.proxy)
    const errorListener = (error) => {
      proxySocket.destroy()
      cb(error)
    }
    proxySocket.once('error', errorListener)

    let response = ''
    const dataListener = (data) => {
      response += data.toString()
      if (!response.endsWith('\r\n\r\n')) {
        // response not completed yet
        return
      }
      proxySocket.removeListener('error', errorListener)
      proxySocket.removeListener('data', dataListener)

      const m = response.match(/^HTTP\/1.1 (\d*)/)
      if (m == null || m[1] == null) {
        proxySocket.destroy()
        return cb(new Error(response.trim()))
      } else if (m[1] !== '200') {
        proxySocket.destroy()
        return cb(new Error(m[0]))
      }
      options.socket = proxySocket // tell super function to use our proxy socket,
      cb(null, super.createConnection(options))
    }
    proxySocket.on('data', dataListener)

    let cmd = 'CONNECT ' + (options.hostname || options.host) + ':' + options.port + ' HTTP/1.1\r\n'
    if (this.proxy.auth) {
      // noinspection JSCheckFunctionSignatures
      const auth = Buffer.from(this.proxy.auth).toString('base64')
      cmd += 'Proxy-Authorization: Basic ' + auth + '\r\n'
    }
    cmd += '\r\n'
    proxySocket.write(cmd)
  }

  createConnection (options, cb) {
    if (this.proxy) {
      Promise.resolve()
        .then(() => {
          if (typeof this.proxy.isHttps !== 'boolean') {
            return isHttpsProxy(this.proxy)
              .then(isHttps => {
                this.proxy.isHttps = isHttps
              })
          }
        })
        .catch()
        .finally(() => this.createConnectionHttpsAfterHttp(options, cb))
    } else {
      cb(null, super.createConnection(options))
    }
  }
}

module.exports = myAgent

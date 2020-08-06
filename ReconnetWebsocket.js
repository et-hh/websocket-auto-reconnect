/**
 * @description 基于sockjs+stompjs的websocket自动重连工具类
 * 封装内容：
 * 1. 一个类对象只使用一个sessionId，断开重连后也是使用这一个sessionId进行重连
 * 2. 对连接状态做封装，防止重复调用connect导致重复连接
 * 3. 断线重连机制
 * 4. stomp内执行websocket的onclose回调时不会把错误信息带给回调，这里做了封装，会把原生websocket错误对象以参数形式传给回调
 * 5. 当sockjs处于连接中状态时，disconnect处理
 * @author zhoujie
 */
import SockJs from '@aicc/assets/sockjs'
import { generateRandom } from '@aicc/utils'
import Stomp from 'stompjs'
const logger = require('@aicc/utils/logger').logger('ReconnetWebsocket')

// 连接状态
const CONNECTING = 'connecting'
const CONNECTED = 'connected'
const FAILD = 'failed'
const DISCONNECTING = 'disconnecting'
const DISCONNECTED = 'disconnected'

export default class ReconnetWebsocket {
  constructor(url) {
    this.status = DISCONNECTED
    this.url = url
    this.stompClient = undefined
    this.timeout = null
    this.sessionId = generateRandom()
    this.successCb = () => {}
    this.errorCb = () => {}
    this.params = {}
    this.shouldReconnect = true
  }

  _onConnectEnd(fn) {
    this.connectEndFns = this.connectEndFns || []
    this.connectEndFns.push(fn.bind(this))
  }

  _connectEnded() {
    if (this.connectEndFns) {
      this.connectEndFns.forEach(fn => fn())
      this.connectEndFns = []
    }
  }

  connect(params = {}, successCb = () => {}, errorCb = () => {}) {
    /**
     * 用户主动调用connect
     *
     * 这种情况需要重连以维护ws的稳定性
     */
    this.shouldReconnect = true

    return new Promise(resolve => {
      if (params instanceof Function) {
        errorCb = successCb
        successCb = params
        params = {}
      }

      this.params = params
      this.errorCb = errorCb
      this.successCb = successCb

      if (this.status === CONNECTED) {
        successCb()
        resolve()
        return
      }

      if (this.status === CONNECTING) {
        return
      }

      this.status = CONNECTING

      const socket = new SockJs(this.url, [], {
        sessionId: () => {
          return this.sessionId
        },
      })

      this.stompClient = Stomp.over(socket)
      this.stompClient.connect(
        {
          Cookie: document.cookie,
          ...(params || {}),
        },
        () => {
          if (this.status === DISCONNECTING) {
            this._connectEnded()
            return
          }

          this.status = CONNECTED
          successCb(this.stompClient)
          resolve(this.stompClient)
        },
        e => {
          this.status = FAILD
          this._connectEnded()
          !errorCb.executed && errorCb(e)
          errorCb.executed = false
          this.reConnect()
          // reject(msg)
        },
      )

      const oldCloseCB = this.stompClient.ws.onclose
      this.stompClient.ws.onclose = e => {
        errorCb(e)
        errorCb.executed = true
        oldCloseCB()
      }
    })
  }

  reConnect() {
    if (!this.shouldReconnect) return

    this.stopTimeout()
    this.disconnect()
    this.shouldReconnect = true
    this.timeout = setTimeout(async () => {
      await this.connect(
        this.params,
        this.successCb,
        this.errorCb,
      )

      // 自定义的重连回调
      // for example:
      //   const ws = new ReconnetWebsocket(
      //     this.host + '/apiEngine/webSocket/userClient',
      //   )
      //   ws.onReconnect = () => {
      //     this.$emit('userClient-reconnected')
      //   }
      if (this.onReconnect) {
        this.onReconnect()
      }
    }, 1500)
  }

  stopReconnect() {
    this.shouldReconnect = false
    this.stopTimeout()
  }

  startReconnect() {
    this.shouldReconnect = true
    this.reConnect()
  }

  stopTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  disconnect() {
    if (this.status === DISCONNECTING || this.status === DISCONNECTED) {
      logger.log('ws already disconnected in util', this.status, this.url)
      return
    }

    logger.log('disconnect ws in util', this.url)
    this.status = DISCONNECTING

    /**
     * 主动调用disconnect
     *
     * 说明不需要重连
     */
    this.shouldReconnect = false

    return new Promise((resolve, reject) => {
      const disconnected = () => {
        this.status = DISCONNECTED
        resolve()
      }

      if (this.stompClient) {
        try {
          this.stompClient.disconnect(disconnected)
        } catch (e) {
          logger.log('--------catch error disconnect------------', e)
          /**
           * stompClient的disconnect方法会给服务器发送一个disconnect帧，所以会调用sockjs的send方法
           * 当ws处于连接中状态时，sockjs的send方法会抛错，导致ws关闭过程中断
           * 而且ws此时会继续连接，最后会变成连接中状态
           * 所以需要等待连接完毕（成功/失败）再去断开
           */
          if (
            String(e).includes(
              'InvalidStateError: The connection has not been established yet',
            )
          ) {
            this._onConnectEnd(() => {
              logger.log('------------finally disconnect----------')
              this.stompClient.disconnect(disconnected)
            })
          }
        }
      } else {
        reject('ws 对象不存在')
      }
    })
  }
}

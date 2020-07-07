/**
 * @description 基于sockjs+stompjs的websocket自动重连工具类
 * 封装内容：
 * 1. 一个类对象只使用一个sessionId，断开重连后也是使用这一个sessionId进行重连
 * 2. 对连接状态做封装，connected：true,connecting,false，防止重复调用connect导致重复连接
 * 3. 断线重连机制
 * 4. stomp内执行websocket的onclose回调时不会把错误信息带给回调，这里做了封装，会把原生websocket错误对象以参数形式传给回调
 * @author zhoujie
 */
import SockJs from '@aicc/assets/sockjs'
import { generateRandom } from '@aicc/utils'
import Stomp from 'stompjs'

export default class ReconnetWebsocket {
  constructor(url) {
    this.connected = false
    this.url = url
    this.stompClient = undefined
    this.timeout = null
    this.sessionId = generateRandom()
    this.successCb = () => {}
    this.errorCb = () => {}
    this.params = {}
  }

  connect(params = {}, successCb = () => {}, errorCb = () => {}) {
    return new Promise(resolve => {
      if (params instanceof Function) {
        errorCb = successCb
        successCb = params
        params = {}
      }

      this.params = params
      this.errorCb = errorCb
      this.successCb = successCb

      if (this.connected === true) {
        successCb()
        resolve()
        return
      }

      if (this.connected === 'connecting') {
        // reject('userClient正在连接中')
        return
      }

      this.connected = 'connecting'

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
          this.connected = true
          successCb(this.stompClient)
          resolve(this.stompClient)
        },
        e => {
          this.connected = false
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
    this.stopTimeout()
    this.disconnect()
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

  stopTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
  }

  disconnect() {
    this.connected = false
    return new Promise((resolve, reject) => {
      if (this.stompClient) {
        this.stompClient.disconnect(resolve)
      } else {
        reject('ws 对象不存在')
      }
    })
  }
}

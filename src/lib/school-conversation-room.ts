import { DurableObject } from 'cloudflare:workers'
import type { ConversationBroadcastPayload } from './conversations'

export class SchoolConversationRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade.', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async broadcast(payload: ConversationBroadcastPayload) {
    const body = JSON.stringify(payload)
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(body)
      } catch {
        socket.close(1011, 'Unable to deliver conversation update.')
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string) {
    if (typeof message !== 'string') return
    if (message === 'ping') {
      ws.send(JSON.stringify({ type: 'conversation:pong', at: new Date().toISOString() }))
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    ws.close(code, reason)
  }
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

const base = process.env.BASE_URL ?? 'http://localhost:8080'
const domain = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'DQGM.dev').split(',')[0]
async function api(path, user, body, expected = 200) {
  const response = await fetch(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(10000) })
  assert.equal(response.status, expected, `${path}: ${response.status}`)
  const text = await response.text()
  return text ? JSON.parse(text) : null
}
async function account() {
  const data = await api('/api/auth/register', null, { email: `collab-${randomUUID()}@${domain}`, displayName: 'Collaboration Smoke', password: 'Password123' }, 201)
  return { id: data.user.id, token: data.accessToken }
}
async function connect(user) {
  const ws = new WebSocket(new URL('/ws', base).href.replace(/^http/, 'ws'), 'v12.stomp')
  const backlog = [], pending = []; let buffer = ''
  function deliver(item) {
    const index = pending.findIndex(waiter => waiter.matches(item))
    if (index >= 0) { const [waiter] = pending.splice(index,1); clearTimeout(waiter.timer); waiter.resolve(item) }
    else backlog.push(item)
  }
  function next(matches) {
    const index = backlog.findIndex(matches)
    if (index >= 0) return Promise.resolve(backlog.splice(index,1)[0])
    return new Promise((resolve,reject) => { const waiter = { matches,resolve,timer:setTimeout(()=>reject(new Error('Collaboration event timeout')),5000) }; pending.push(waiter) })
  }
  ws.addEventListener('message', ({data}) => {
    buffer += String(data); let end
    while ((end=buffer.indexOf('\0'))>=0) {
      const frame=buffer.slice(0,end).trimStart();buffer=buffer.slice(end+1)
      if (frame.startsWith('CONNECTED')) deliver({type:'connected'})
      else if(frame.startsWith('MESSAGE')) deliver(JSON.parse(frame.slice(frame.indexOf('\n\n')+2)))
      else if(frame.startsWith('ERROR')) deliver({type:'error',frame})
    }
  })
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})})
  const send=frame=>ws.send(frame+'\0')
  send(`CONNECT\naccept-version:1.2\nhost:localhost\nAuthorization:Bearer ${user.token}\n\n`);await next(x=>x.type==='connected')
  for(const queue of ['acks','events','notifications','typing','session'])send(`SUBSCRIBE\nid:${queue}\ndestination:/user/queue/${queue}\n\n`)
  send('SEND\ndestination:/app/session/ping\n\n{}');await next(x=>x.type==='session:pong')
  return {
    event:type=>next(x=>x.type===type), close:()=>ws.close(),
    command:async (destination,payload,ok=true)=>{
      const correlationId=randomUUID();send(`SEND\ndestination:/app/${destination}\ncontent-type:application/json\n\n${JSON.stringify({type:destination.replace('.',':'),payload,correlationId,ts:new Date().toISOString()})}`)
      const ack=await next(x=>x.type==='ack'&&x.payload.correlationId===correlationId);assert.equal(ack.payload.ok,ok,JSON.stringify(ack));return ack.payload
    },
  }
}
const a=await account(),b=await account(),c=await account()
const room=await api('/api/rooms',a,{name:`Collab-${randomUUID().slice(0,24)}`},201)
const sa=await connect(a),sb=await connect(b)
try {
  await sb.command('room.join',{roomId:room.id})
  const payload={roomId:room.id,content:'Mention and retry',clientMsgId:randomUUID(),mentions:[b.id]}
  const sent=await sa.command('message.send',payload)
  assert.equal(sent.data.receipts.recipients,1)
  assert.equal((await sb.event('notification:new')).payload.type,'mention')
  assert.equal((await sa.command('message.send',payload)).data.id,sent.data.id)
  assert.equal((await api('/api/notifications',b)).notifications.length,1)
  const receipt=await sb.command('message.seen',{messageId:sent.data.id})
  assert.equal(receipt.data.receipts.seen,1);assert.equal(receipt.data.receipts.delivered,1)
  assert.equal((await sa.event('message:seen')).payload.id,sent.data.id)
  assert.equal((await sb.command('message.edit',{messageId:sent.data.id,content:'attack'},false)).error.code,'forbidden')
  await sa.command('message.edit',{messageId:sent.data.id,content:'edited'})
  for(let i=0;i<2;i++)await sb.command('message.react',{messageId:sent.data.id,emoji:'👍',active:true})
  assert.equal((await api(`/api/rooms/${room.id}/messages`,a)).messages[0].reactions.length,1)
  await sa.command('typing.start',{roomId:room.id});assert.equal((await sb.event('typing:start')).payload.userId,a.id)
  const other=await api('/api/rooms',a,{name:`Other-${randomUUID().slice(0,24)}`},201)
  assert.equal((await sa.command('message.send',{...payload,roomId:other.id,mentions:[]},false)).error.code,'invalid_payload')
  const form=new FormData();form.set('roomId',room.id);form.set('file',new Blob(['%PDF-1.4\nSmoke\n%%EOF'],{type:'application/pdf'}),'demo.pdf')
  const upload=await api('/api/uploads',a,form,201)
  await api(upload.url,b,undefined,403)
  const attachment=await sa.command('message.send',{roomId:room.id,content:'',clientMsgId:randomUUID(),uploadId:upload.id})
  const download=await fetch(new URL(upload.url,base),{headers:{Authorization:`Bearer ${b.token}`}})
  assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.match(await download.text(),/^%PDF/)
  await api(upload.url,c,undefined,403)
  await sa.command('message.delete',{messageId:attachment.data.id});await api(upload.url,b,undefined,403)
  await api('/api/admin/stats',a,undefined,403)
  const notifications=await api('/api/notifications',b);await api(`/api/notifications/${notifications.notifications[0].id}/read`,b,{})
  assert.equal((await api('/api/notifications',b)).unreadCount,0)
  assert.ok((await api('/api/presence',a)).users.find(u=>u.userId===b.id).online)
  console.log('PASS F05–F15 collaboration on MySQL: notification dedup/read, receipts, edit permissions, reaction idempotency, typing, global retry keys, uploads/attachment access/deletion, presence and admin denial. Admin privileged operations are covered by backend integration tests.')
} finally {sa.close();sb.close()}

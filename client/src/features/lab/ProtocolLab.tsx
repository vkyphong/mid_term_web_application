import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { config } from '../../config'
import { refreshAccessToken } from '../../lib/apiClient'
import { useLogout, useSession } from '../auth/hooks'
import { validateWorkload } from './measurements'
import { runProtocol } from './runner'
import { defaultWorkload, PROTOCOLS, protocolNames, type LabProgress, type LabResult, type Protocol, type Workload } from './types'
import './lab.css'

const colors: Record<Protocol, string> = { poll: '#9a70e8', 'long-poll': '#408ac8', sse: '#259b85', websocket: '#d68d35' }
const ms = (value: number | null) => value === null ? '—' : value.toFixed(2)
const bytes = (value: number) => value < 1024 ? `${value} B` : `${(value / 1024).toFixed(2)} KiB`

function LatencyChart({ results }: { results: LabResult[] }) {
  const complete = results.filter((r) => r.status === 'complete')
  const max = Math.max(1, ...complete.flatMap((r) => [r.p50Ms ?? 0, r.p95Ms ?? 0]))
  return (
    <section className="lab-panel" aria-labelledby="latency-chart-title">
      <div className="lab-panel-heading"><div><h2 id="latency-chart-title">Độ trễ phản hồi</h2><p>Chỉ so sánh bài đo hoàn tất · thấp hơn là nhanh hơn</p></div><span className="lab-unit">ms</span></div>
      <div className="lab-bar-chart" role="img" aria-label={complete.length ? complete.map((r) => `${protocolNames[r.protocol]}: p50 ${ms(r.p50Ms)} ms, p95 ${ms(r.p95Ms)} ms`).join('; ') : 'Chưa có bài đo hoàn tất'}>
        {PROTOCOLS.map((protocol) => {
          const result = complete.find((r) => r.protocol === protocol)
          return <div className="lab-bar-row" key={protocol}>
            <span className="lab-bar-label"><i style={{ background: colors[protocol] }} />{protocolNames[protocol]}</span>
            <div className="lab-bar-pair">
              <div><span className="lab-bar" style={{ width: `${Math.max(result ? 1 : 0, (result?.p50Ms ?? 0) / max * 100)}%`, background: colors[protocol], opacity: .45 }} /><span>{result ? ms(result.p50Ms) : '—'}</span></div>
              <div><span className="lab-bar" style={{ width: `${Math.max(result ? 1 : 0, (result?.p95Ms ?? 0) / max * 100)}%`, background: colors[protocol] }} /><span>{result ? ms(result.p95Ms) : '—'}</span></div>
            </div>
          </div>
        })}
      </div>
      <div className="lab-chart-legend"><span><i className="lab-legend-light" />p50</span><span><i />p95</span></div>
    </section>
  )
}

function CostChart({ results }: { results: LabResult[] }) {
  const complete = results.filter((r) => r.status === 'complete')
  const maxRequests = Math.max(1, ...complete.map((r) => r.metrics.httpRequests))
  const maxHeaders = Math.max(1, ...complete.map((r) => r.metrics.requestHeaderBytesEstimate + r.metrics.responseHeaderBytesEstimate))
  return (
    <section className="lab-panel" aria-labelledby="cost-chart-title">
      <div className="lab-panel-heading"><div><h2 id="cost-chart-title">Chi phí trao đổi</h2><p>Hai thang đo riêng · header là ước lượng HTTP/1.1</p></div></div>
      <div className="lab-cost-chart">
        {PROTOCOLS.map((protocol) => {
          const r = complete.find((r) => r.protocol === protocol)
          const headers = r ? r.metrics.requestHeaderBytesEstimate + r.metrics.responseHeaderBytesEstimate : 0
          return <div className="lab-cost-row" key={protocol}>
            <strong>{protocolNames[protocol]}</strong>
            <div><span>HTTP requests <b>{r ? r.metrics.httpRequests : '—'}</b></span><meter min={0} max={maxRequests} value={r?.metrics.httpRequests ?? 0} aria-label={`HTTP requests ${protocolNames[protocol]}`} /></div>
            <div><span>Header ước lượng <b>{r ? bytes(headers) : '—'}</b></span><meter min={0} max={maxHeaders} value={headers} aria-label={`Header bytes ${protocolNames[protocol]}`} /></div>
          </div>
        })}
      </div>
      <p className="lab-panel-note">WebSocket có 1 HTTP Upgrade riêng, chưa đo byte handshake. Không gộp handshake vào số HTTP request của workload.</p>
    </section>
  )
}

function SampleChart({ results }: { results: LabResult[] }) {
  const complete = results.filter((r) => r.status === 'complete')
  const max = Math.max(1, ...complete.flatMap((r) => r.samples.map((s) => s.latencyMs)))
  const count = Math.max(2, ...complete.map((r) => r.config.count))
  return (
    <section className="lab-panel lab-samples" aria-labelledby="samples-title">
      <div className="lab-panel-heading"><div><h2 id="samples-title">Latency theo từng tin</h2><p>Cùng vị trí trong workload · đơn vị ms · đỉnh thang {ms(max)} ms</p></div></div>
      {complete.length ? <svg viewBox="0 0 900 180" role="img" aria-label="Biểu đồ latency từng tin của các bài đo hoàn tất">
        {[12, 90, 168].map((y) => <line key={y} x1="10" x2="890" y1={y} y2={y} stroke="var(--border)" strokeDasharray="4 5" />)}
        {complete.map((r) => <polyline key={r.protocol} fill="none" stroke={colors[r.protocol]} strokeWidth="2" points={r.samples.map((s) => `${10 + s.index / (count - 1) * 880},${168 - s.latencyMs / max * 156}`).join(' ')}><title>{protocolNames[r.protocol]}</title></polyline>)}
      </svg> : <p className="lab-empty">Chạy bài đo để xem biểu đồ theo từng tin.</p>}
      <div className="lab-protocol-legend">{PROTOCOLS.map((p) => <span key={p}><i style={{ background: colors[p] }} />{protocolNames[p]}</span>)}</div>
    </section>
  )
}

export function ProtocolLab() {
  const { user, session } = useSession()
  const logout = useLogout()
  const navigate = useNavigate()
  const [workload, setWorkload] = useState<Workload>({ ...defaultWorkload })
  const [selected, setSelected] = useState<Protocol | 'all'>('all')
  const [results, setResults] = useState<LabResult[]>([])
  const [progress, setProgress] = useState<LabProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState('')
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const invalid = validateWorkload(workload)
  const sequence = selected === 'all' ? [...PROTOCOLS] : [selected]
  const completed = results.filter((r) => r.status === 'complete').length

  useEffect(() => {
    mounted.current = true
    const onHidden = () => {
      if (document.hidden && controller.current) {
        controller.current.abort()
        setMessage('Đã dừng vì tab bị ẩn. Hãy giữ Lab ở phía trước để lịch gửi không bị trình duyệt làm chậm.')
      }
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => { mounted.current = false; controller.current?.abort(); document.removeEventListener('visibilitychange', onHidden) }
  }, [])

  const start = async (event: FormEvent) => {
    event.preventDefault()
    if (invalid || running || config.useMockApi) return
    const runController = new AbortController()
    controller.current = runController
    setRunning(true); setMessage(''); setResults([])
    const snapshot = { ...workload }
    const execute = async () => {
      // Refresh outside measured setup/traffic. Never silently retry a measured request.
      if (session && session.expiresAt - Date.now() < sequence.length * (snapshot.count * snapshot.intervalMs + 20_000) + 30_000) {
        if (!await refreshAccessToken()) throw new Error('Không làm mới được phiên. Vui lòng đăng nhập lại.')
      }
      for (const protocol of sequence) {
        if (runController.signal.aborted) break
        const result = await runProtocol(protocol, snapshot, runController.signal, (p) => { if (mounted.current) setProgress(p) })
        if (mounted.current) setResults((previous) => [...previous, result])
        if (result.status !== 'complete') break
      }
    }
    try {
      if (navigator.locks) await navigator.locks.request('pulsechat-protocol-lab', { ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error('Một tab khác đang chạy Protocol Lab. Dừng bài đo ở tab đó rồi thử lại.')
        await execute()
      })
      else await execute()
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'Không chạy được bài đo.')
    } finally {
      if (controller.current === runController) controller.current = null
      if (mounted.current) { setRunning(false); setProgress(null) }
    }
  }

  const download = () => {
    const report = {
      schemaVersion: 1, generatedAt: new Date().toISOString(), userAgent: navigator.userAgent, origin: window.location.origin,
      methodology: { clock: 'performance.now() in the same browser', latency: 'ping submission to correlated pong on selected delivery transport; POST response ignored', scheduling: 'absolute offsets i * intervalMs; no catch-up bursts', httpRequests: 'attempted Lab fetches including baseline and SSE setup; excludes app/auth traffic and WS upgrade', httpHeaders: 'HTTP/1.1 text model of explicit request headers + Host + Content-Length, and fetch-visible response headers; browser-managed headers/HPACK/QPACK not measured', wsHandshake: 'one HTTP upgrade; byte size unavailable', wsFrames: 'one unfragmented, uncompressed text frame per ping/pong; client masked; auth/control frames excluded', exclusions: ['TLS', 'TCP/IP', 'HTTP chunk framing', 'compression', 'authentication setup'], validity: 'only complete trials are charted; cancellation/failure remain explicit' },
      results,
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `protocol-lab-${new Date().toISOString().replace(/:/g, '-')}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="lab-app">
      <header className="lab-header">
        <Link to="/" className="brand"><span className="brand-dot" aria-hidden="true" />{config.appName}</Link>
        <nav aria-label="Điều hướng Lab"><Link to="/">Chat</Link>{user?.role === 'admin' && <Link to="/admin">Dashboard</Link>}<span className="lab-user-name">{user?.displayName}</span><button className="lab-button" disabled={logout.isPending} onClick={() => { controller.current?.abort(); logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) }) }}>Đăng xuất</button></nav>
      </header>
      <main className="lab-main">
        <div className="lab-page-heading"><div><p className="lab-eyebrow">F13 / KP1 · NETWORK EXPERIMENTS</p><h1>Protocol Lab</h1><p>Một workload. Bốn giao thức. So sánh bằng số liệu thực tế.</p></div><span className="lab-badge">HTTP · SSE · RAW WS</span></div>
        {config.useMockApi && <p className="lab-alert" role="alert">Lab cần backend thật. Tắt VITE_USE_MOCK_API để chạy thử.</p>}
        {message && <p className="lab-alert" role="status">{message}</p>}
        <div className="lab-layout">
          <aside className="lab-controls">
            <section className="lab-panel"><div className="lab-panel-heading"><div><h2>Cấu hình bài đo</h2><p>Áp dụng giống nhau cho mọi giao thức.</p></div></div>
              <form onSubmit={(e) => void start(e)}>
                <fieldset disabled={running}>
                  <label>Giao thức<select value={selected} onChange={(e) => setSelected(e.target.value as Protocol | 'all')}><option value="all">Tất cả 4 giao thức</option>{PROTOCOLS.map((p) => <option value={p} key={p}>{protocolNames[p]}</option>)}</select></label>
                  {([
                    ['count', 'Số tin', 5, 100, '5–100 tin / giao thức'],
                    ['intervalMs', 'Khoảng gửi (ms)', 100, 1000, 'Lịch gửi cố định, không chờ pong'],
                    ['payloadBytes', 'Payload text (byte)', 0, 1024, 'ASCII x, ngoài JSON envelope'],
                    ['pollMs', 'Chu kỳ polling (ms)', 50, 1000, 'Chỉ áp dụng cho Polling'],
                  ] as const).map(([key, label, min, max, hint]) => <label key={key}>{label}<input type="number" min={min} max={max} step={1} required value={Number.isFinite(workload[key]) ? workload[key] : ''} onChange={(e) => setWorkload((old) => ({ ...old, [key]: e.target.valueAsNumber }))} /><small>{hint}</small></label>)}
                </fieldset>
                <div className="lab-workload-summary"><span>Thời lượng / giao thức<strong>{Number.isFinite(workload.count * workload.intervalMs) ? (workload.count * workload.intervalMs / 1000).toFixed(1) : '—'} giây</strong></span><span>Tần suất mục tiêu<strong>{Number.isFinite(workload.intervalMs) && workload.intervalMs > 0 ? (1000 / workload.intervalMs).toFixed(1) : '—'} tin/giây</strong></span></div>
                {invalid && <p className="lab-error" role="alert">{invalid}</p>}
                {running ? <button key="stop" type="button" className="lab-button lab-button--stop" onClick={(e) => { e.preventDefault(); controller.current?.abort(); setMessage('Đã yêu cầu dừng. Bài đo chưa đủ mẫu sẽ không được đưa vào biểu đồ so sánh.') }}>Dừng bài đo</button> : <button key="start" type="submit" className="lab-button lab-button--primary" disabled={Boolean(invalid) || config.useMockApi}>▶ Chạy {selected === 'all' ? 'cả 4 giao thức' : protocolNames[selected]}</button>}
              </form>
            </section>
            <section className="lab-method"><h2>Đo như thế nào?</h2><p>Ping gửi qua HTTP POST hoặc raw WebSocket. Chỉ ghi nhận khi pong đến qua đúng giao thức đang thử.</p><p>Latency dùng <code>performance.now()</code> trên cùng trình duyệt. Không lấy giờ server trừ giờ client.</p><p>Giữ tab ở phía trước. Bài đo dừng khi tab bị ẩn; setup và thời gian chờ kết nối nằm ngoài latency.</p><Link to="/lab#methodology">Xem phạm vi và giới hạn ↓</Link></section>
          </aside>

          <div className="lab-results">
            <section className="lab-run-status" aria-live="polite"><div><span className={`lab-status-dot ${running ? 'lab-status-dot--running' : ''}`} /><strong>{progress ? `${protocolNames[progress.protocol]} · ${progress.phase === 'setup' ? 'Đang thiết lập' : `${progress.received}/${workload.count} pong`}` : results.length ? `${completed}/${results.length} bài đo hoàn tất` : 'Sẵn sàng thử nghiệm'}</strong></div>{running && <span>Đã gửi {progress?.sent ?? 0}/{workload.count}</span>}<progress max={workload.count * sequence.length} value={completed * workload.count + (progress?.received ?? 0)} aria-label="Tiến trình bài đo" /></section>
            <div className="lab-comparison-charts"><LatencyChart results={results} /><CostChart results={results} /></div>
            <SampleChart results={results} />
            <section className="lab-panel" aria-labelledby="results-title"><div className="lab-panel-heading"><div><h2 id="results-title">Kết quả chi tiết</h2><p>Dữ liệu của lần chạy gần nhất; JSON bao gồm cấu hình và mọi mẫu đo.</p></div><button className="lab-button" disabled={!results.length || running} onClick={download}>Tải JSON</button></div>
              {results[0] && <p className="lab-panel-note">Cấu hình kết quả: {results[0].config.count} tin · {results[0].config.intervalMs} ms/tin · {results[0].config.payloadBytes} byte text · polling {results[0].config.pollMs} ms.</p>}
              <div className="lab-table-scroll"><table className="lab-table"><thead><tr><th>Giao thức</th><th>Trạng thái / mẫu</th><th>p50 / p95 (ms)</th><th>HTTP req / resp</th><th>Header ước lượng</th><th>WS Upgrade / frame</th></tr></thead><tbody>
                {results.length === 0 && <tr><td colSpan={6} className="lab-empty">Chưa có kết quả. Chọn cấu hình và bấm chạy để bắt đầu.</td></tr>}
                {results.map((r) => <tr key={r.protocol}><th scope="row"><i style={{ background: colors[r.protocol] }} />{protocolNames[r.protocol]}<small>Setup {ms(r.setupMs)} ms</small></th><td><span className={`lab-result-status lab-result-status--${r.status}`}>{r.status === 'complete' ? 'Hoàn tất' : r.status === 'cancelled' ? 'Đã dừng' : 'Lỗi'}</span><small>{r.samples.length}/{r.config.count} mẫu · lịch {(r.config.count * r.config.intervalMs / 1000).toFixed(1)} s</small></td><td>{ms(r.p50Ms)} / {ms(r.p95Ms)}<small>Max {ms(r.maxMs)} ms</small></td><td>{r.metrics.httpRequests} / {r.metrics.httpResponses}<small>{r.metrics.setupHttpRequests} request setup</small></td><td>{bytes(r.metrics.requestHeaderBytesEstimate + r.metrics.responseHeaderBytesEstimate)}<small>↑ {bytes(r.metrics.requestHeaderBytesEstimate)} · ↓ {bytes(r.metrics.responseHeaderBytesEstimate)}</small></td><td>{r.metrics.wsHandshakeCount} Upgrade<small>Frame ≈ {bytes(r.metrics.wsFrameOverheadBytesEstimate)}</small></td></tr>)}
              </tbody></table></div>
              {results.filter((r) => r.error).map((r) => <p className="lab-error lab-result-error" key={r.protocol} role="alert">{protocolNames[r.protocol]}: {r.error}</p>)}
            </section>
          </div>
        </div>

        <section className="lab-panel lab-methodology" id="methodology" aria-labelledby="method-title"><div className="lab-panel-heading"><div><h2 id="method-title">Phạm vi phép đo</h2><p>Cách tính minh bạch để đọc và tái lập kết quả.</p></div></div><div className="lab-method-grid"><div><h3>Workload & latency</h3><p>Mỗi giao thức chạy lần lượt với cùng số tin, chu kỳ gửi, số byte text và thời lượng mục tiêu. Mã ping được đối chiếu qua pong; HTTP POST trả về không được dùng thay kết quả Polling/Long Polling/SSE. p50/p95 dùng nearest-rank. Thời gian chờ pong cuối có thể kéo dài sau lịch gửi.</p></div><div><h3>HTTP requests & headers</h3><p>Đếm mọi Lab fetch đã bắt đầu, gồm snapshot cursor và mở SSE; không gồm đăng nhập, chat hay Upgrade WS. Req/resp khác nhau nếu request bị hủy hoặc lỗi. Header dùng mô hình text HTTP/1.1: header request chủ động, Host, Content-Length và header response mà fetch đọc được. Header do trình duyệt tự thêm, HPACK/QPACK và byte handshake không đo được.</p></div><div><h3>WebSocket & payload</h3><p>Dùng trực tiếp <code>/lab/ws</code>, không STOMP. Một HTTP Upgrade được ghi riêng. Frame overhead ước lượng theo RFC 6455, một text frame không nén/không phân mảnh, client có masking; không gồm auth/control frame. JSON xuất riêng body HTTP và payload WS. Không tính TLS, TCP/IP, HTTP chunk framing hoặc nén.</p></div><div><h3>Độ tin cậy</h3><p>Kết quả phản ánh trình duyệt, thiết bị và backend đơn đang chạy, không phải kiểm thử tải hay năng lực production. Không tự retry trong bài đo. Mất kết nối, hết phiên, tràn lịch sử, lịch gửi trễ quá một chu kỳ hoặc dừng thủ công đều làm bài đo không hoàn tất. Chỉ bài hoàn tất xuất hiện trong biểu đồ so sánh.</p></div></div></section>
        <footer className="lab-footer">{config.appName} · Protocol Lab · F13 / KP1</footer>
      </main>
    </div>
  )
}
